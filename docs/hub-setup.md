# Hub setup

## Auth setup (Supabase dashboard)

1. Done 2026-11-04. On GitHub (Settings > Developer settings > OAuth Apps), create an OAuth app with Authorization callback URL `https://wsivoyqhtmpnxjakowpi.supabase.co/auth/v1/callback`.
2. Done 2026-11-04. In Supabase, open Authentication > Providers > GitHub. Paste the OAuth app's client id and client secret, then turn it on.
3. Done 2026-11-04. In Authentication > URL Configuration:
   - Site URL: `https://masonbair.com`
   - Redirect URLs:
     - `https://masonbair.com/hub/auth/callback`
     - `https://*-<vercel-team-slug>.vercel.app/hub/auth/callback` for preview deploys. The team slug is the part after `vercel.com/` in the Vercel dashboard URL, and it also ends every preview URL.
     - `masonbair-collector://auth/callback` for the mobile app
4. Pending. After Mason's first sign-in, open Authentication > Sign In / Providers and turn off "Allow new users to sign up".

Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `HUB_OWNER_GITHUB_ID` (`77211262`, from `gh api users/masonbair --jq .id`). Without `HUB_OWNER_GITHUB_ID`, nobody gets in.

## Events: reminders, approval fire and daily backup (Supabase Vault)

Migration `0004_hub_events.sql` adds three calls from the database to the site, all sent through pg_net:

| What | When | Calls |
| --- | --- | --- |
| `hub-reminders` cron job | every 5 minutes | `POST /api/hub/events/reminders` |
| `hub-backup` cron job | daily at 03:00 UTC | `POST /api/hub/events/backup` |
| `items_fire_approved` trigger | Mason adds `claude` to an open item | `POST /api/hub/events/approved` with `{ "id": ... }` |

They read the site URL and a token from two Vault secrets. Until both exist, every call does nothing, and Mason's edits still save.

Never add the `net` schema to the exposed schemas in Supabase (Project Settings > Data API): pg_net's tables keep each queued request, bearer token included.

A reminder is sent once, up to 15 minutes late if a run fails or is late. If a backup fails, or the newest backup is over 36 hours old, the backup job sends "Hub backup failed: ..." to `NTFY_TOPIC`.

1. Make a token on your laptop: `openssl rand -hex 32`. Keep it in your password manager.
2. In Vercel (Project > Settings > Environment Variables, Production), add `HUB_EVENTS_TOKEN` set to that token. Also check `NTFY_TOPIC` is set (reminders need it) and `BLOB_STORE_ID` is set (backups need it). `HUB_TIME_ZONE` is optional; due times are read as `America/Denver` without it. Leave `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN` unset until the cutover; until then the approved event answers 503 and fires nothing. Redeploy so the function sees the new values.
3. In the Supabase dashboard, open the project, then SQL Editor > New query, and run this with your own token pasted in:
   ```sql
   select vault.create_secret('https://masonbair.com', 'hub_events_url');
   select vault.create_secret('<token from step 1>', 'hub_events_token');
   ```
   The URL is the site root with no path and no trailing slash. Use the host that answers without a redirect (if `masonbair.com` redirects to `www.masonbair.com`, use the `www` one). Then clear the query text from the editor so the token is not kept in its history.
4. Check it, still in the SQL Editor:
   ```sql
   select public.hub_post_event('reminders');
   ```
   It returns a number (null means a secret is missing). A few seconds later:
   ```sql
   select status_code, content from net._http_response order by id desc limit 1;
   ```
   shows `200` and `{"reminded":[]}`. A `401` means the two tokens differ; a `503` means the Vercel env var is missing.
5. See the jobs and their runs: `select jobname, schedule from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 10;`.

To change the token later, set the new value in Vercel and redeploy, then run:
```sql
select vault.update_secret((select id from vault.secrets where name = 'hub_events_token'), '<new token>');
```

## Restore a backup

Backups are private files in the Vercel Blob store at `hub-backups/YYYY-MM-DD.json`; the newest 30 are kept. Download one from Vercel (Storage > the blob store > Browser), then:

```sh
node scripts/hub-restore.ts hub-backups-2026-11-05.json --target postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

- It only restores into a database whose `items` table is empty, and stops with a non-zero exit otherwise.
- It refuses any host but `localhost`, `127.0.0.1` or `::1` unless you add `--i-know-this-is-live`. For the live project, use the direct connection string (Project Settings > Database) with the `postgres` user, after the migrations have been applied there.
- It runs in one transaction with `session_replication_role = replica`, so the hub guard triggers (which refuse done items, `claude` labels and Mason's comments from anyone but the signed-in owner) are skipped for the restore only.
- It restores items (with archive reason, client key and completed time), comments, `hub_state`, `memo_files`, and the `now_place`, `now_place_privacy` and `now_bake` rows (ids kept, identity sequences moved past them).
- `audit_log` is not in the backups at all, so its history is lost if the database is.
- It does not restore `hub_owner` (sign in again and you are recorded), `audit_log` (history only), auth users, or the `updated_at` time of `hub_state` rows.

## Agent connector (MCP)

Claude Code (and other agents) reach the hub through `https://masonbair.com/api/mcp/mcp`. It only offers find, read, add, update, comment, merge-duplicate and the public now board; nothing can complete, delete, email, buy, book, deploy or merge.

- `HUB_AGENT_TOKEN` (already set in Vercel) is the bearer token. If it is unset the connector answers 503; a missing or wrong token gets 401.
- Requests carrying an `Origin` header (browsers) get 403, and bodies over 1 MB get 413.
- `X-Client-Name` names the agent in `audit_log` and in an added item's source (`agent:<name>`); letters, digits, `.`, `_`, `-`, up to 40 characters, otherwise `unknown`.

Production:
```sh
claude mcp add --transport http hub https://masonbair.com/api/mcp/mcp --header "Authorization: Bearer <HUB_AGENT_TOKEN>" --header "X-Client-Name: claude-code"
```

Local (`npm run dev`, with `HUB_AGENT_TOKEN` in `.env.local`):
```sh
claude mcp add --transport http hub-local http://localhost:3000/api/mcp/mcp --header "Authorization: Bearer $HUB_AGENT_TOKEN" --header "X-Client-Name: claude-code"
```
