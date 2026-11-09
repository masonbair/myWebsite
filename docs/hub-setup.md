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
4. Done 2026-11-04 (checked: `hub_owner` holds one row, GitHub id 77211262, and `disable_signup` is true). After Mason's first sign-in, open Authentication > Sign In / Providers and turn off "Allow new users to sign up".

Deleting Mason's auth user (Authentication > Users) fails with "rows in hub_owner are never deleted". That is by design: the hub never loses its owner.

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
2. In Vercel (Project > Settings > Environment Variables, Production), add `HUB_EVENTS_TOKEN` set to that token. Also check `NTFY_TOPIC` is set (reminders need it) and `BLOB_STORE_ID` is set (backups need it). Add `HUB_TIME_ZONE` (an IANA zone such as `America/Denver`); it is required, and without it the reminders event answers 503 instead of guessing the zone due times are written in. Reminders use the zone from the phone's newest place ping instead when that ping is 7 days old or less and names a real zone; `HUB_TIME_ZONE` covers every other case. Leave `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN` unset until the cutover; until then the approved event answers 503 and fires nothing. Redeploy so the function sees the new values.
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
- It also restores `items_history` (earlier titles and descriptions) and `audit_log`, ids kept. Backups made before 2026-11-05 hold neither.
- It restores the Collector app's `collector_photo` rows (with `hidden`) and `collector_daylio_export` rows, ids kept. It does not restore `collector_heartbeat` or any Storage file (`photos`, `daylio` buckets).
- The phone will not upload those files again on its own: it remembers what it already sent. To fill the new buckets, clear the Collector app's data (Settings > Apps > Collector > Storage > Clear data) or reinstall it, then sign in again. Each upload then succeeds and its RPC is a no-op, because the restored row already exists. Clearing data also wipes the private places, the Daylio folder choice and the "Report my place" switch: mark home private again before turning reporting back on.
- A backup that holds a private place with no city (sent by the Collector app) restores only into a database that already has `0007_collector.sql` applied.
- It does not restore `hub_owner`, auth users, or the `updated_at` time of `hub_state` rows. Mason is recorded as the owner again on his first sign-in.
- Restoring into a new Supabase project: turn "Allow new users to sign up" on just long enough for Mason's first sign-in, then off again (see Auth setup, step 4).

## Agent connector (MCP)

Claude Code (and other agents) reach the hub through `https://masonbair.com/api/mcp/mcp`. It only offers find, read, add, update, comment, merge-duplicate and the public now board; nothing can complete, delete, email, buy, book, deploy or merge.

- `HUB_AGENT_TOKEN` (already set in Vercel) is the bearer token. If it is unset the connector answers 503; a missing or wrong token gets 401.
- Requests carrying an `Origin` header (browsers) get 403, and bodies over 1 MB get 413, including chunked bodies that send no length.
- Agents can only change or comment on open items. When an agent (or the worker) changes an item's title or description, the old text is kept in `items_history` and shows on the item page under "Earlier versions".
- `X-Client-Name` names the agent in `audit_log` and in an added item's source (`agent:<name>`); letters, digits, `.`, `_`, `-`, up to 40 characters, otherwise `unknown`.

Production:
```sh
claude mcp add --transport http hub https://masonbair.com/api/mcp/mcp --header "Authorization: Bearer <HUB_AGENT_TOKEN>" --header "X-Client-Name: claude-code"
```

Local (`npm run dev`, with `HUB_AGENT_TOKEN` in `.env.local`):
```sh
claude mcp add --transport http hub-local http://localhost:3000/api/mcp/mcp --header "Authorization: Bearer $HUB_AGENT_TOKEN" --header "X-Client-Name: claude-code"
```

## Site analytics (/hub/analytics)

Public page reads are counted in `proxy.ts` and written to Supabase through `analytics_record` (migration 0012). Nothing is stored per request: rows are daily counts. Visitor hashes are kept only for the current day, then turned into counts.

1. Vercel env (Production and Preview): `ANALYTICS_SALT` = a long random string, e.g. the output of `openssl rand -hex 32`. Without it, bots and page views are still counted but unique visitors are not.
2. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must already be set (the hub uses them).
3. Run `supabase db push` for 0012. It adds a pg_cron job, `analytics-roll-visitors`, at 05:10 UTC.
4. New public routes: add them to `KNOWN_PATHS` in `lib/analytics/classify.ts`, or they show as "other".

Abuse limits: per day, at most 5,000 distinct count rows (the rest fold into one "overflow" row), 20,000 visitor hashes and 200 unknown-bot samples. If junk traffic ever gets heavy, add a Vercel Firewall rate-limit rule (Project → Firewall → Rules → Rate limit, e.g. 120 requests per minute per IP on `/`). Check the plan price first.

## Timeline (/hub/timeline)

One plain-words summary per project per day, written by the `daily-log` Claude skill (`~/.claude/skills/daily-log`) through the connector's `log_day` tool. Rows are never deleted; agents can only write today and the two days before (UTC), so a past day stays as it was. Every write is in `audit_log` with action `timeline`.

1. Run `supabase db push` for 0013.
2. Add the connector for the skill once, with `HUB_AGENT_TOKEN`: `claude mcp add --scope user --transport http hub https://masonbair.com/api/mcp/mcp --header "Authorization: Bearer <HUB_AGENT_TOKEN>" --header "X-Client-Name: daily-log"`.
3. The hourly timer is `~/.claude/skills/daily-log/run-hourly.sh` under launchd. It only starts Claude when a day's commits changed.
