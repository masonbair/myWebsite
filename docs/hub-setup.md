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

## Ideas Lab

- Migration `0008_ideas_lab.sql` adds the Ideas Lab tables, guards, the review claim, the Google token helpers (Vault secret `ideas_google_refresh_token`) and the `hub-ideas` cron job (every 15 minutes, `POST /api/hub/events/ideas`). Not applied live yet; Mason runs `supabase db push` after review.
- Local testing: `scripts/ideas-local-stack.sh` starts a private stack (project `ideas-lab`, every port +100) from a copy of `supabase/` under `$TMPDIR/ideas-lab-supabase`, then `supabase db reset --workdir <that dir> && supabase test db --workdir <that dir>`.

### HiNote recording intake (read-only, Mac)

Until HiNote memos move to the hub, ideas spoken in Mac HiNote recordings reach the Ideas Lab through a small read-only job. The HiNote flow itself (hinote-sync, then todo-hub, then Todoist) is not touched.

- What it does: every 15 minutes `scripts/ideas-recording-sync.ts` lists `~/HiNotes/transcripts/*.txt` (hinote-sync's folder: `home = ~/HiNotes`, transcripts named `<recording stem>.txt`) and posts each new one to `POST /api/hub/ideas/recording` as `{ file: <stem>, recorded: <file mtime, local>, transcript }`. The hub keeps one `idea_recordings` row per file name and writes nothing else; the Ideas Lab job reads it like a memo.
- It never writes in the transcripts folder. It remembers what it sent in `~/.config/hub/ideas-recording-sent.json`. A 200 or 201 counts as sent. A 400 or 413 is marked `rejected <status>` and not sent again. A 401, a 5xx or no network stops the run without marking anything, so the next run tries again. It skips empty transcripts and ones changed in the last two minutes. Its first run sends nothing old (step 4). Its log (`~/Library/Logs/ideas-recording.log`) holds file names and status codes only, never transcript text.
- It refuses to run unless `~/.config/hub/ideas-recording-token` is a plain file of yours with mode 600.

Install (Mason, on the Mac; migration 0008 must be live first):

1. Make the token without printing it:
   ```sh
   mkdir -p ~/.config/hub && chmod 700 ~/.config/hub
   (umask 077 && openssl rand -hex 32 > ~/.config/hub/ideas-recording-token)
   chmod 600 ~/.config/hub/ideas-recording-token
   ```
2. In Vercel (myWebsite, Production) add `IDEAS_RECORDING_TOKEN` with the same value, then redeploy: `vercel env add IDEAS_RECORDING_TOKEN production < ~/.config/hub/ideas-recording-token`. Until it is set the route answers 503.
3. Copy the script out of `~/Desktop`, since a launchd job cannot read Desktop files without a privacy grant. Copy it again after any change to the script:
   ```sh
   cp ~/Desktop/programming/myWebsite/scripts/ideas-recording-sync.ts ~/.config/hub/ideas-recording-sync.ts
   ```
4. Old transcripts are not sent unless you ask. On its first run (no `~/.config/hub/ideas-recording-sent.json` yet) the script marks every transcript already in the folder `skipped at install`, sends nothing and exits 0. From then on only new transcripts go. Each one sent costs a Haiku detection call and can file idea items that are never deleted, so a backlog could use up the month's cap. To send old ones on purpose, run it once by hand with an opt-in:
   ```sh
   node ~/.config/hub/ideas-recording-sync.ts ~/HiNotes/transcripts --since 2026-11-01   # those changed on or after that local date
   node ~/.config/hub/ideas-recording-sync.ts ~/HiNotes/transcripts --include-existing   # all of them
   ```
   This works before or after the first run: it sends the matching `skipped at install` files and leaves the rest skipped.
5. Fill the plist's placeholders and install it. `ABSOLUTE_NODE_24_PATH` is the full path of a Node 24 binary (`command -v node`, and check `node --version` prints v24). If that path changes (a Node upgrade under nvm), fill and reload the plist again.
   ```sh
   NODE="$(command -v node)"; "$NODE" --version
   sed -e "s#ABSOLUTE_NODE_24_PATH#$NODE#" -e "s#ABSOLUTE_HOME_PATH#$HOME#g" \
     ~/Desktop/programming/myWebsite/hub/ideas-recording/com.masonbair.ideas-recording.plist \
     > ~/Library/LaunchAgents/com.masonbair.ideas-recording.plist
   plutil -lint ~/Library/LaunchAgents/com.masonbair.ideas-recording.plist
   ```
6. Try one run by hand, then load the job (it also runs once at load):
   ```sh
   "$NODE" ~/.config/hub/ideas-recording-sync.ts; echo "exit $?"
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.masonbair.ideas-recording.plist
   launchctl print gui/$(id -u)/com.masonbair.ideas-recording | grep -E 'state|last exit'
   ```
   Exit 0 is a clean run, 1 means it stopped and will retry, 2 means it refused: the token file is missing, empty or not mode 600; the sent file is not valid JSON; `HUB_URL` is not https (plain http is allowed only to localhost or 127.0.0.1); or an argument is wrong.
7. Check: within 15 minutes of a new recording's transcript, its ideas show in the Ideas Lab with the footer `From HiNote recording <file>, recorded <time>`. A recording the Ideas Lab could not read after three tries shows under "Could not read" as `HiNote recording <file>` with Try again.

Uninstall (also the first step of the memo-detection cutover in `docs/hub-cutover-notes.md`):

```sh
launchctl bootout gui/$(id -u)/com.masonbair.ideas-recording
rm ~/Library/LaunchAgents/com.masonbair.ideas-recording.plist
rm ~/.config/hub/ideas-recording-sync.ts
```

Keep `~/.config/hub/ideas-recording-sent.json` if you may install it again. To close the route as well, remove `IDEAS_RECORDING_TOKEN` in Vercel and redeploy (it then answers 503). Rows already in `idea_recordings` stay; they are never deleted.
