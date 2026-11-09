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
- It also restores the six Ideas Lab tables (`ai_usage`, `idea_settings`, `idea_reviews`, `idea_sources`, `idea_resurface`, `idea_recordings`), ids kept, inserts only. Replica mode also keeps the Ideas Lab intake trigger from queuing restored items again. Backups made before the Ideas Lab hold none of them and still restore.
- It does not restore `hub_owner`, `idea_google`, auth users, or the `updated_at` time of `hub_state` rows. Mason is recorded as the owner again on his first sign-in.
- Restoring into a new Supabase project: turn "Allow new users to sign up" on just long enough for Mason's first sign-in, then off again (see Auth setup, step 4).

## Agent connector (MCP)

Claude Code (and other agents) reach the hub through `https://masonbair.com/api/mcp/mcp`. It offers find, read, add, update, comment, merge-duplicate, the public now board, and three read-only idea tools (`ideas_list`, `idea_get` with every review version, `ai_costs` for ideas or news spend against its monthly budget); nothing can start a review, touch the calendar, write idea data, complete, delete, email, buy, book, deploy or merge.

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

The Ideas Lab (`/hub/ideas`) has Claude review each idea Mason saves, finds ideas in his inbox captures and recordings, and brings ideas back on a Google calendar named Ideas. Ideas stay ordinary hub items; the Lab adds its own tables beside them.

### 1. Order of going live

1. Deploy this branch's code to production first. It adds `/api/hub/events/ideas`, which the new cron job calls; if the job ran before the route existed, every call would fail.
2. Then Mason applies migration `0008_ideas_lab.sql` himself. Check what would run before running it:
   ```sh
   supabase db push --dry-run
   supabase db push
   ```
   The dry run should list only `0008_ideas_lab.sql`, plus `0007_collector.sql` if that one is not applied yet. Stop if it lists anything else.

The migration adds the Ideas Lab tables, their guards, the review claim, the Google token helpers (Vault secret `ideas_google_refresh_token`) and the `hub-ideas` cron job (every 15 minutes, `POST /api/hub/events/ideas`).

Timeout to check on the first preview run: `pg_net` gives up on its request after 30 seconds, but one ideas run lasts up to 270 seconds. Vercel should keep the function running after the caller hangs up. Check this once: start a run with pending work, then confirm `ai_usage` rows land more than 30 seconds after the run started (`select at from ai_usage order by at desc limit 5;`). If nothing lands after the 30-second mark, Vercel stopped the run; move the job into `after()` in the route so it runs once the response is sent.

Dates: idea footers, "Mentioned again" dates and the start of an idea's return schedule use Mason's local time (the zone of his latest place ping, else `HUB_TIME_ZONE`). The one exception is the database's enroll trigger for ideas he types in, which still uses the database's `current_date` (UTC).

Local testing: `scripts/ideas-local-stack.sh` starts a private stack (project `ideas-lab`, every port +100) from a copy of `supabase/` under `$TMPDIR/ideas-lab-supabase`, then `supabase db reset --workdir <that dir> && supabase test db --workdir <that dir>`.

### 2. Anthropic key

1. In the Anthropic Console (org "Mason's Individual Org"), make a workspace named `masonbair-ideas` and set its monthly spend limit to about $30. This is the hard stop; the app's own cap (below) stops earlier.
2. Make an API key in that workspace.
3. Add it to Vercel (myWebsite). Type the value at the prompt so it never lands in shell history, then redeploy:
   ```sh
   vercel env add ANTHROPIC_API_KEY_IDEAS production
   ```
   Newsletter trends use their own key, `ANTHROPIC_API_KEY_NEWS`; do not reuse it here.

### 3. Optional settings

Leave these unset unless you want to change the default. Add one the same way (`vercel env add <NAME> production`), then redeploy.

| Name | Default | What it does |
| --- | --- | --- |
| `IDEAS_MONTHLY_BUDGET_USD` | `20` | The app's monthly cap in dollars (see Costs below). |
| `IDEAS_WEB_SEARCH` | on | Set to `off` to stop reviews from searching the web. |
| `IDEAS_MEMO_DETECTION` | off | Set to `on` only at the memo cutover; see "Ideas Lab: memo detection" in `docs/hub-cutover-notes.md`. |

### 4. Google Calendar connect

The Ideas Lab adds idea returns to its own Google calendar named Ideas. It asks Google for one permission only, `https://www.googleapis.com/auth/calendar.app.created`: make its own calendars and manage events on them. It cannot see your other calendars or events.

Google Cloud (once, at console.cloud.google.com, signed in as the Google account whose calendar you want):

1. Project picker at the top, **New project**. Name it `masonbair hub`, **Create**, then select it.
2. **APIs & Services**, **Library**. Search **Google Calendar API**, open it, **Enable**.
3. **Google Auth Platform** (older consoles: **APIs & Services**, **OAuth consent screen**), **Get started**. App name `masonbair hub`, your email as support and contact email. Audience **External**. **Create**.
4. **Data Access**, **Add or remove scopes**. Paste `https://www.googleapis.com/auth/calendar.app.created` under **Manually add scopes**, **Add to table**, tick it, **Update**, **Save**.
5. **Audience**, **Publish app**, confirm, so the status reads **In production**. Do not leave it in Testing: Google expires a Testing app's tokens after 7 days.
6. **Clients**, **Create client**. Type **Web application**, name `hub`. Under **Authorized redirect URIs** add both:
   - `https://masonbair.com/hub/ideas/google/callback`
   - `http://localhost:3000/hub/ideas/google/callback` (local dev)

   A preview deploy uses its own address (`https://<preview host>/hub/ideas/google/callback`); add it only if you want to connect from that preview. **Create**, then copy the client ID and secret from the dialog.

Vercel (myWebsite). Type each value at the prompt, then redeploy:

```sh
vercel env add GOOGLE_OAUTH_CLIENT_ID production
vercel env add GOOGLE_OAUTH_CLIENT_SECRET production
```

Connect: open `/hub/ideas/settings` and tap **Connect Google Calendar**. Google shows an "unverified app" warning once; choose **Advanced**, then **Go to masonbair hub**, then allow. The hub keeps the lasting token in Supabase Vault (`ideas_google_refresh_token`) and makes the Ideas calendar.

- If the settings page says Google did not give a lasting token, remove `masonbair hub` at myaccount.google.com/permissions and connect again.
- **Disconnect** on the settings page revokes the token at Google and blanks it in Vault. The Ideas calendar and its events stay in your account, and connecting again reuses that calendar.
- Removing the app at myaccount.google.com/permissions also works; the job's next calendar call notices and marks Google disconnected.

Does `calendar.app.created` need Google verification? Not for this use. Google's verification page (https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) says verification is not needed "if you are the only user of your app", where you click past the unverified app screen. Only your account connects. Google's scope list (https://developers.google.com/workspace/calendar/api/auth) does not say whether this scope is sensitive; if step 4 lists it under "Your sensitive scopes", the answer stays the same. Verification would matter only if other people connected their calendars.

### 5. Phone

On the phone, open Google Calendar, then Settings, and turn on sync for the Ideas calendar. A new calendar can start hidden on Android, so ideas brought back would not show until you do.

### 6. Mac recording intake (read-only HiNote)

Until HiNote memos move to the hub, ideas spoken in Mac HiNote recordings reach the Ideas Lab through a small read-only job. The HiNote flow itself (hinote-sync, then todo-hub, then Todoist) is not touched.

- What it does: every 15 minutes `scripts/ideas-recording-sync.ts` lists `~/HiNotes/transcripts/*.txt` (hinote-sync's folder: `home = ~/HiNotes`, transcripts named `<recording stem>.txt`) and posts each new one to `POST /api/hub/ideas/recording` as `{ file: <stem>, recorded: <file mtime with its local offset>, transcript }`. `recorded` is local time with the offset the Mac had at that moment, such as `2026-11-09T16:25:03-05:00`, so a recording made while travelling keeps its true instant; idea footers show it in UTC. The hub keeps one `idea_recordings` row per file name and writes nothing else; the Ideas Lab job reads it like a memo.
- It never writes in the transcripts folder. It remembers what it sent in `~/.config/hub/ideas-recording-sent.json`. A 200 or 201 counts as sent. A 400 or 413 is marked `rejected <status>` and not sent again. A 401, a 5xx or no network stops the run without marking anything, so the next run tries again. It skips empty transcripts and ones changed in the last two minutes. Its log (`~/Library/Logs/ideas-recording.log`) holds file names and status codes only, never transcript text.
- Its first run skips the backlog: it sends nothing old (step 4).
- It refuses to run unless `~/.config/hub/ideas-recording-token` is a plain file of yours with mode 600.

Install (Mason, on the Mac; migration 0008 must be live first):

1. Make the token without printing it:
   ```sh
   mkdir -p ~/.config/hub && chmod 700 ~/.config/hub
   (umask 077 && openssl rand -hex 32 > ~/.config/hub/ideas-recording-token)
   chmod 600 ~/.config/hub/ideas-recording-token
   ```
2. In Vercel (myWebsite, Production) add `IDEAS_RECORDING_TOKEN` with the same value, then redeploy. Until it is set the route answers 503.
   ```sh
   vercel env add IDEAS_RECORDING_TOKEN production < ~/.config/hub/ideas-recording-token
   ```
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
   Exit 0 is a clean run. 1 means it stopped and will retry. 2 means it refused: the token file is missing, empty or not mode 600; the sent file is not valid JSON; `HUB_URL` is not https (plain http is allowed only to localhost or 127.0.0.1); or an argument is wrong.
7. Check: within 15 minutes of a new recording's transcript, its ideas show in the Ideas Lab with the footer `From HiNote recording <file>, recorded <YYYY-MM-DD HH:MM> UTC`. A recording the Ideas Lab could not read after three tries shows under "Could not read" as `HiNote recording <file>` with Try again.

Uninstall (also the first step of the memo-detection cutover in `docs/hub-cutover-notes.md`):

```sh
launchctl bootout gui/$(id -u)/com.masonbair.ideas-recording
rm ~/Library/LaunchAgents/com.masonbair.ideas-recording.plist
rm ~/.config/hub/ideas-recording-sync.ts
```

Keep `~/.config/hub/ideas-recording-sent.json` if you may install it again. To close the route as well, remove `IDEAS_RECORDING_TOKEN` in Vercel and redeploy (it then answers 503). Rows already in `idea_recordings` stay; they are never deleted.

### 7. Checks after going live

In the Supabase SQL Editor:

1. The job is scheduled:
   ```sql
   select jobname, schedule from cron.job where jobname = 'hub-ideas';
   ```
   One row, schedule `*/15 * * * *`.
2. The site answers the job:
   ```sql
   select public.hub_post_event('ideas');
   ```
   It returns a number (null means a Vault secret is missing; see "Events" above). A few seconds later:
   ```sql
   select status_code, content from net._http_response order by id desc limit 1;
   ```
   shows `200`. A `401` means the events tokens differ; a `503` means a Vercel env var is missing.

Then in the browser:

3. `https://masonbair.com/hub/ideas` loads.
4. Capture something with **Save as idea**. It lands in the Ideas list and gets a review within about 30 minutes. That is one paid review, about $0.25.

### 8. Costs and the cap

- A review costs about $0.25. Detection (finding ideas in captures and recordings) costs cents.
- The app adds up each month's spend in `ai_usage`. When it reaches `IDEAS_MONTHLY_BUDGET_USD` (default $20), new reviews pause, wait in order, and start again next month or when the cap is raised. The phone gets one "Idea reviews paused" notice that month.
- Detection keeps running a little past the cap (up to 1.25 times it) so no idea is lost, then stops too.
- The Console workspace limit (about $30) is the hard stop above both.
- See spend on `/hub/ideas/settings`, or through the connector's `ai_costs` tool.

### 9. Backups

The daily backup and `scripts/hub-restore.ts` include the six Ideas Lab tables: `ai_usage`, `idea_settings`, `idea_reviews`, `idea_sources`, `idea_resurface` and `idea_recordings`. `idea_google` is left out: it holds only connection state, and the Google token lives in Vault, so after a restore you connect Google again. See "Restore a backup" above.

## Site analytics (/hub/analytics)

Public page reads are counted in `proxy.ts` and written to Supabase through `analytics_record` (migration 0012). Nothing is stored per request: rows are daily counts. Visitor hashes are kept only for the current day, then turned into counts.

1. Vercel env (Production and Preview): `ANALYTICS_SALT` = a long random string, e.g. the output of `openssl rand -hex 32`. Without it, bots and page views are still counted but unique visitors are not.
2. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must already be set (the hub uses them).
3. Run `supabase db push` for 0012. It adds a pg_cron job, `analytics-roll-visitors`, at 05:10 UTC.
4. New public routes: add them to `KNOWN_PATHS` in `lib/analytics/classify.ts`, or they show as "other".

Abuse limits: per day, at most 5,000 distinct count rows (the rest fold into one "overflow" row), 20,000 visitor hashes and 200 unknown-bot samples. If junk traffic ever gets heavy, add a Vercel Firewall rate-limit rule (Project → Firewall → Rules → Rate limit, e.g. 120 requests per minute per IP on `/`). Check the plan price first.
