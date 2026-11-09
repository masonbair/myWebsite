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
- It also restores the newsletter tables: sources, extraction runs, issues, shared articles, clusters, companies, topics and stories, ids kept and identity sequences moved. Issue `clean_text` and shared `fetched_text` are not in the backup, so they come back empty. The text can be rebuilt later from the raw emails kept in Blob. Trend tables are rebuilt from the restored stories. `news_sec_tickers` is not backed up (it downloads again). Built-in sources and topics already in the target are updated, not duplicated.
- It does not restore `hub_owner`, auth users, or the `updated_at` time of `hub_state` rows. Mason is recorded as the owner again on his first sign-in.
- Restoring into a new Supabase project: turn "Allow new users to sign up" on just long enough for Mason's first sign-in, then off again (see Auth setup, step 4).

## Agent connector (MCP)

Claude Code (and other agents) reach the hub through `https://masonbair.com/api/mcp/mcp`. It only offers find, read, add, update, comment, merge-duplicate, the public now board and five read-only newsletter tools; nothing can complete, delete, email, buy, book, deploy or merge.

- News tools: `news_search` (stories by text, topic, company, ticker, source, dates; shared-article stories included; headline, topics, companies, tone, date, source, private link), `news_trend` (stories and mentions per day, week or month for a topic or company), `news_movers` (coverage up or down over the last N days against the N before), `news_get_issue` (one issue's text and stories) and `news_costs` (spend by month against the cap). They read only the current extraction run, describe coverage and never advise, and are read-only.

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

## Newsletter trends

Forwarded newsletters arrive by email, get read by Claude, and feed `/trends` and `/hub/news`. Do these steps in order.

Migration push order: `0008_ideas_lab.sql`, then `0009_news.sql`, then `0010_news_topics_cron.sql`. Do not skip ahead: 0010 changes the `ai_usage` table, and 0008 is the file that creates it.

1. Gmail filter and export. Make a filter for the six newsletter senders with "Apply label: Newsletters" and "Also apply to matching conversations". Then in Google Takeout export Mail, only the label Newsletters, and send the `.mbox` path to Claude. Do the filter and export in each Gmail account that gets newsletters (there are two), so you end up with one `.mbox` file per account.
2. Anthropic key. Done on 2026-11-09: workspace `masonbair-news` (monthly limit $30; raise to $75 for the import month) and its key set as `ANTHROPIC_API_KEY_NEWS` in Vercel Production. Add the same `ANTHROPIC_API_KEY_NEWS` to Preview too, and put it in the worktree's `.env.local`.
3. Sender rows. Claude fills each newsletter's `sender_addresses` or `sender_domains` in the seed of `0009_news.sql` (Task 0) before it is pushed. Mail that matches no newsletter is held back, not read.
4. Push 0009. Mason runs `supabase db push` for `0009_news.sql`. Claude never pushes. Phone-collector's `0007` may land after `0008` and `0009`; once a later-numbered migration is on the live database, a plain `supabase db push` refuses the older file, so push it with `supabase db push --include-all`.
5. Deploy. Merge and let Vercel deploy. Nothing reads mail yet.
6. Resend and its webhook.
   - Sign up (free plan). Add the domain `in.masonbair.com` with receiving turned on. Resend shows an MX record: at IONOS (where masonbair.com DNS lives) add it with host `in`. Leave the main domain's `mx00.ionos.com` and `mx01.ionos.com` records alone. Wait until Resend says verified. The inbound address is `news@in.masonbair.com`.
   - Protection bypass. In Vercel, turn on "Protection Bypass for Automation" for the project and copy the secret. Keep it private. It goes only in the test webhook URL below.
   - Add a webhook for the event `email.received`. While testing, use `<preview URL>/api/news/inbound?x-vercel-protection-bypass=<bypass secret>`. At launch, change it to `https://masonbair.com/api/news/inbound`. Then make a full-access API key (reading received mail needs full access).
   - Vercel env, in both Preview and Production: `RESEND_API_KEY` (the full-access key), `RESEND_INBOUND_SECRET` (the webhook signing secret from Resend), `NEWS_FORWARD_FROM` (a comma-separated list of every Gmail address that forwards newsletters, for example `you@gmail.com, you2@gmail.com`), and optionally `NEWS_MONTHLY_BUDGET_USD` (default 25). Redeploy so the functions see them.
   - Testing on a preview writes to the live database and the live Blob store, because there is only one. So the preview also needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `BLOB_STORE_ID` set for Preview. Without them the inbound route fails.
7. Gmail forwarding. Settings > Forwarding > Add a forwarding address: `news@in.masonbair.com`. Gmail sends a confirmation mail. Open `/hub/news`, find it under "Held back", and click the confirmation link. Then edit the step 1 filter to also forward to that address. Do this whole step in each Gmail account, and list every account in `NEWS_FORWARD_FROM`. Mail from an account that is not in the list waits under "Held back".
8. Push 0010. After review of the topics work, Mason runs `supabase db push` for `0010_news_topics_cron.sql`. This starts the news job (every 30 minutes). Push it before any job run and before any backfill `collect`: both write `ai_usage.news_issue_id`, which only 0010 adds.
9. Backfill. When the import estimate appears, read it and type `yes`.

How it is checked: a mail is processed only when Gmail forwarding names one of the `NEWS_FORWARD_FROM` addresses as the sender and a DKIM signature (the mail's proof of origin) that matches the From domain verifies. Any other mail waits in `/hub/news` under "Held back" and is never picked up for reading: the job that claims issues takes only pending, failed and stuck ones, never held ones.

Held-back mail that is really a newsletter (a new sender address, say) can be sent on from its page under "Held back": pick the newsletter and press Release. It is read on the next run.

Turning a newsletter private or switching a topic off changes what the public trend tables may show, but rows already counted stay until their dates are rebuilt. Rebuild every date once in the Supabase SQL editor: `select public.news_refresh_trends('2000-01-01', current_date);`

### Import past newsletters and re-run extraction

`scripts/news-backfill.ts`, run with `npm run news:backfill -- <command>`. It reads its settings from the shell. Load them once per terminal: `vercel env pull --environment=production .env.production.local`, then `set -a; . ./.env.production.local; set +a`. It needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY_NEWS`, and `BLOB_STORE_ID` with `VERCEL_OIDC_TOKEN` (good for 12 hours; pull again when it expires). It refuses a Supabase URL that is not https unless you pass `--local`, which also keeps raw emails in a temp folder instead of Blob.

1. Fill each newsletter's `sender_addresses` or `sender_domains` in `news_sources` first. Mail that matches no newsletter is held back (quarantined), not read.
2. `import --mbox <Takeout .mbox> --since <YYYY-MM-DD>`: stores every message dated on or after that day as a `backfill` issue. It prints counts per newsletter, duplicates (safe to run twice), held-back mail, and mail before the date. Run `import` once for each Takeout file (one per account). A newsletter that sits in both accounts is stored once, because its Message-ID matches.
3. `reclean`: refills empty issue text from the raw email in Blob (after a restore, or if cleaning failed at import).
4. `estimate [--model claude-sonnet-5-5|claude-haiku-5-5|claude-opus-5-5]`: prints the issue count per newsletter and the cost at batch (half) price. It counts input tokens on 10 sample issues and assumes 2,500 output tokens per issue. It also shows the most the later grouping step can cost, and skips issues whose text is empty. Then it asks `Type yes to submit`. Anything else sends nothing. `submit` does the same.
5. `collect`: run it once the batches end (usually within an hour, at most 24). It writes the stories under a new `backfill` run, logs each issue's cost in `ai_usage` (purpose `backfill`, not counted toward the monthly cap), and moves issues to done. Then it shows the most that grouping the new stories (Haiku calls at full price) can cost and asks `Type yes to cluster`; any other answer skips it, and running `collect` again asks again. Trends for the run's dates are rebuilt either way. Issues that failed go to the daily job as `failed`. Running it again is safe.
6. Re-run after a prompt or topic change: `estimate --rerun --from <YYYY-MM-DD> --to <YYYY-MM-DD>`, type `yes`, then `collect`. New stories go under a new `rerun` run that becomes current; old rows stay, so a bad run can be undone by pointing issues back at the old run.
