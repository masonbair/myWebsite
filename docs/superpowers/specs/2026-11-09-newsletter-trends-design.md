# Newsletter trends: design

Date: 2026-11-09. Written from Mason's decisions, passed on by the coordinator.

This is a sixth project for masonbair.com. It builds on the hub (project 2, live) and needs email intake (project 4, not built yet). Read `docs/superpowers/specs/2026-11-03-masonbair-personal-hub-design.md` first; this doc uses its words and rules.

Tags used below:
- **(Mason)**: Mason decided this.
- **(Coordinator's call)**: the coordinator decided this for Mason. The builder follows it and flags it if it causes trouble.
- **(Spec writer's call)**: a smaller call made while writing this doc. Same rule as the coordinator's calls.

## Intent

Mason reads six daily newsletters in Gmail: The Rundown AI, Morning Brew, Tech Brew, The Hustle, Superhuman and Mindstream. Reading them is fine. The problem is that what they say is gone a day later. **(Mason)**

He wants to keep what they say in his own database and use it later, mostly to see trends:
- market trends, and news that moves stocks;
- how a topic (for example climate change, or AI chips) rises, falls or changes tone over months.

Articles he shares from his phone into the hub go into the same record. **(Mason)**

He uses it in two ways **(Mason)**:
1. **Mainly by asking Claude.** "What did my newsletters say about Nvidia this quarter?" "Is climate coverage going up or down?" Claude answers through the hub connector.
2. **A small public dashboard** on masonbair.com that shows trends only.

## Goals

- Every issue of the six newsletters lands in the hub on its own, with no daily action from Mason.
- Each issue is broken into stories. Each story records what it is about (topics, companies and stock tickers), its tone, its date and its source.
- The same story told by three newsletters counts as one story with three sources, not three stories.
- Claude can answer trend questions over months of data through the hub connector, with read-only tools.
- A public page and board tile show which topics and companies are rising or falling, and their tone, with links back to the newsletters.
- One year of past issues is imported once, so trends work from day one.
- What it costs to run is visible, and has a cap.

## Non-goals

- A newsletter reader. Mason keeps reading them in Gmail.
- Live or same-hour updates. Within a few hours of the email arriving is fine.
- Price data, charts of stock prices, or any market feed. This records what the newsletters say, not what the market did.
- Newsletters beyond the six, or other sources (RSS, podcasts, X). Adding a source later should be a config row, but it is not built now.
- Agents writing to this data. The new connector tools only read.

## Anti-goals (failure even if it technically works)

- **Publishing the writers' work.** The public side never shows newsletter text, quotes, headlines, or summaries of it, including headlines "in our own words". Only names of topics and companies, counts, tone, dates and links back. **(Mason)**
- **Trading advice.** No buy or sell signals, price targets, "bullish/bearish" calls, or ranked "stocks to watch", in the dashboard or in the connector tools. Claude may describe what the newsletters said; the system never turns it into a recommendation. **(Coordinator's call)**
- **Leaking Mason's subscriptions.** Links inside a newsletter email often carry Mason's personal tracking or unsubscribe code. These links never reach the public page. See "Public links".
- **Silent spending.** Claude API costs that grow without Mason seeing them, or with no cap.
- **Losing an issue.** An email that arrives is stored even if extraction fails. A failure is retried and visible, never dropped.
- **Newsletter text steering the system.** Email text is data. It can never cause a tool call, a write to other hub data, or an email.
- **The public page reading raw text.** If a bug in the public page could ever expose newsletter text, the design is wrong. The public page can only reach tables that hold no text.

## Constraints

- Same stack as the hub: Next.js 16 on Vercel, Supabase project `masonbair` (ref `wsivoyqhtmpnxjakowpi`), Vercel Blob (private, OIDC, `BLOB_STORE_ID`), pg_cron and pg_net with Vault secrets, ntfy.
- Free or nearly free. The Claude API is paid, but Mason's Claude Ultra plan includes $200 a month of Claude API credits in his linked Console org, "Mason's Individual Org" (credits do not roll over; https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers). Expected use is a few dollars a month plus a one-time import, well inside the credits. A monthly cap stops spending. **(Mason)**
- Supabase free plan: 500 MB database. Raw emails are large, so they go to Blob, not Postgres.
- Hub rules carry over: owner-only row-level security (each row readable only by Mason's login), no deletes on source data, migrations reviewed for security and applied with `supabase db push` only after local tests pass. Mason reviews every migration before it reaches the live database.
- The builder never writes Vercel env vars or Vault secrets. Mason adds them; the builder lists them in `docs/hub-setup.md`.
- Copy has no em dashes. Plain words. Same palette and type as the public site.

---

## How it works (overview)

```
Gmail filter ──forward──▶ news@<inbound domain> ──webhook──▶ /api/news/inbound
                                                               │ verify, store raw in Blob,
                                                               │ save issue row (status: pending)
Phone share ──▶ /hub/share (unchanged) ──▶ inbox item ──also──▶ shared-article row (pending)
                                                               │
pg_cron every 30 min ──pg_net──▶ /api/hub/events/news ─────────┘
        picks pending rows ▶ Claude API extracts stories ▶ dedupe ▶ refresh trend tables
                                                               │
          ┌────────────────────────────────────────────────────┴───────────┐
   MCP connector (read-only news tools)                     Public /trends page + board tile
   reads private tables, owner token                        reads trend tables only (no text)
```

---

## 1. Intake: email

### Dependency on project 4 **(Mason)**

Intake is forwarding. Mason sets a Gmail filter that auto-forwards the six newsletters to an address on his domain, for example `news@masonbair.com`; the chosen address is `news@in.masonbair.com` (below). That needs email receiving on the domain, which is project 4. Project 4 is not built.

### Minimal inbound piece if project 4 is not done **(Coordinator's call)**

Build only what this project needs, in a way project 4 can keep:

- **Resend inbound** receives mail and posts each message to a webhook on the site. Use a **subdomain**: the address is `news@in.masonbair.com` **(Mason, approved 2026-11-09)**. A subdomain gets its own mail records (MX records, the DNS entries that say which server takes a domain's mail), so the main domain's IONOS mail records stay untouched. This avoids the risky DNS move that project 4 must plan carefully (see its "Watch out" section).
- Note the earlier spec chose Cloudflare Email Routing for receiving. Cloudflare can only forward to another inbox or run a Cloudflare Worker; it cannot post to the site's webhook by itself. Resend inbound posts directly. When project 4 is built, it decides whether the main domain uses Resend too. Either way, this project only needs "a message to the news address reaches `/api/news/inbound` with the raw email".
- **Webhook check:** verify Resend's signature on every call (secret `RESEND_INBOUND_SECRET`). Unsigned or wrongly signed calls get 401 and nothing is stored.
- **Sender check:** a message is processed only if it came through Mason's Gmail forwarding and its original sender matches one of the six newsletters' known sender addresses (kept in a `news_sources` table). Anything else is stored as `quarantined`: kept, never extracted, visible on the private news page.
- **Gmail's confirmation email.** Gmail will not forward until Mason clicks a link Gmail sends to the forwarding address. That email lands in quarantine. The private news page shows quarantined messages with a "view" button so Mason can open the link. **This is the first thing to test end to end.**
- **Duplicates:** the email's `Message-ID` is unique. A retried webhook or a re-forward saves nothing new.
- Agents never send email. Nothing in this project sends email.

### What is stored per issue

- **Raw email** (the full `.eml` file) in private Vercel Blob at `news/raw/YYYY/MM/<message-id-hash>.eml`. Never public. **(Coordinator's call: full text kept privately for Mason's own use)**
- **Cleaned text** in Postgres: the email turned into plain text with tracking links, footers and ads stripped, roughly 10 to 20 KB per issue. One year of six newsletters is about 30 to 40 MB, which fits the free plan.
- Source, subject, received time, publish date, the newsletter's public "read online" link if one can be made safe (see "Public links"), and processing status.

## 2. Intake: shared articles **(Mason: same record)**

The share target at `/hub/share` keeps working exactly as it does today: a share becomes one inbox item. Do not change that flow's behavior or its redirect.

In addition, when a share has a URL **(Spec writer's call)**:
- A `news_shared` row is added, pointing at the inbox item (same database write, so both exist or neither does).
- The job fetches the page once, server-side, and keeps the readable text privately. If the fetch fails (paywall, block, timeout), it extracts from the shared title and text alone and marks the row `thin`.
- Its stories go into the same stories table with source `shared`.
- **Shared articles are private only (Spec writer's call, from the builder check).** They feed Claude's answers but are left out of `news_trends_daily`, so the public page counts only the six newsletters and never shows what Mason reads on his own. Mason can opt in later.

---

## 3. Extraction: issues into stories

### What a story record holds **(Coordinator's call)**

| Field | What it is |
|---|---|
| Headline | One line, in Claude's own words, never copied. Private only. |
| Topics | 1 to 3 topics from a fixed list (below). |
| Companies | Names, each with a stock ticker and exchange when it is a listed company. |
| Sentiment | Tone of the story toward its main subject, on a 5-step scale from -2 (very negative) to +2 (very positive). |
| Story date | The date the newsletter published it. |
| Source | Which newsletter (or `shared`), and which issue. |
| Link | The article the newsletter points to, if any. Private only (see "Public links"). |
| Kind | `news`, `sponsor` or `other`. Sponsored sections are kept but left out of trends. |

### Topic list **(Spec writer's call)**

Free-form topics drift ("AI", "artificial intelligence", "GenAI") and ruin counts. So topics come from a fixed list in a `news_topics` table, about 30 to 50 entries (for example "AI models", "chips", "climate change", "interest rates", "jobs", "retail", "crypto").

- The builder drafts the first list by running extraction on two weeks of past issues with open topics, grouping the results, and writing them down. Mason does not need to approve it; he can edit the table later.
- Claude may also suggest a new topic per story. Suggestions are stored, never used in trends until added to the list. The private news page shows the most common suggestions.
- Changing the list means re-running extraction (see "Re-running").

### Companies and tickers **(Spec writer's call)**

- A `news_companies` table holds one row per company: canonical name, ticker, exchange, other names it goes by.
- Claude names companies; the job matches them to this table. New ones are added.
- Tickers for US listed companies are checked against the SEC's free public ticker list (`company_tickers.json`). A ticker that is not on it is kept but marked unverified. Non-US tickers are all "unverified" for now.
- **Public page (Spec writer's call, from the builder check):** every company appears by name, including private ones like OpenAI. Only the ticker is hidden when it is unverified.

### Same story, several newsletters (dedupe) **(Coordinator's call)**

Many stories run in three newsletters on the same day. Each newsletter's version stays as its own row (so "who covered it" is kept), and rows that are the same story share one **story cluster**. Trend counts count clusters, not rows.

How **(Spec writer's call)**:
1. Find candidates cheaply: stories within 3 days of each other that share a company or a topic plus similar headline words.
2. Ask a small model (Claude Haiku 5.5) "same news event or not?" for each candidate pair.
3. A story with no match starts a new cluster.

Trends then count both "stories" (clusters) and "mentions" (rows). Mentions say how loudly a story was covered.

### Re-running

Extraction will improve (better prompt, new topics). So:
- Each run is an `extraction_run` row (model, prompt version, date).
- A re-run writes new story rows under the new run and marks that run as current for the issue. Old rows are never deleted. Trends read only current rows.
- This keeps the hub's "nothing is deleted" rule and makes a bad run easy to undo.

### Safety of extraction

- The model call has no tools. It only returns structured data (Claude's structured output mode, which forces the reply to match a JSON shape).
- The prompt says the email is data, never instructions.
- Output is checked against the shape; anything that fails is retried once, then marked `failed` and shown on the private page.

---

## 4. The background job

### Where it runs **(Coordinator's call: Vercel function + Claude API)**

Options were:

| Option | For | Against |
|---|---|---|
| **Vercel function calling the Claude API** (chosen) | Same pattern as the hub's reminders and backup: pg_cron calls a site endpoint through pg_net. Each step is plain code, cheap, testable, and logs its exact token use and cost. Runs today. | Needs an Anthropic API key and paid usage. |
| Existing cloud worker (the Claude Code routine) | No API key; uses Mason's plan. | Not live on the hub until project 5. It is a full agent session for a job that is one fixed call per issue: slower, harder to test, and its cost is hard to see. It runs about 4 times a day, so trends lag. |

### Shape

- New event `news` in the existing events route (`/api/hub/events/[event]`), same bearer token (`HUB_EVENTS_TOKEN`), same Vault secrets. A pg_cron job calls it every 30 minutes **(Spec writer's call)**.
- Each run takes a few pending issues and shared articles, extracts them, runs dedupe on the new stories, then refreshes the trend tables. It stops early to stay inside the function's time limit; the next run picks up the rest.
- Two runs at once must not process the same issue: claim rows with one atomic update, like `hub_claim()` does for items.
- Failed issues retry up to 3 times with growing gaps, then stay `failed`. A daily ntfy message lists failures if there are any.
- If the email webhook has not delivered anything from a newsletter for 3 days, ntfy says so. That usually means the Gmail filter broke.

### Models **(Coordinator's call: latest models, picked per job)**

| Job | Model | Why |
|---|---|---|
| Daily extraction | **Claude Sonnet 5.5** (`claude-sonnet-5-5`), low effort | Splitting an issue into stories, judging tone, naming the right company and writing a faithful headline in its own words need judgment. Mistakes here poison every trend. Sonnet is half Opus's price and should be good enough. |
| Dedupe "same story?" | **Claude Haiku 5.5** (`claude-haiku-5-5`) | Short yes/no comparison of two lines. Very cheap. |
| Backfill | Same as daily, through the Message Batches API | Half price; speed does not matter for a one-time import. |
| Quality check | **Claude Opus 5.5** (`claude-opus-5-5`) | Only in the comparison below, as the reference. Not in the daily pipeline. |

**Before choosing for good, the builder compares** **(Spec writer's call)**: run 20 real issues through Haiku 5.5, Sonnet 5.5 and Opus 5.5. Put the outputs side by side in one local page (stories found, topics, tickers, tone). Pick the cheapest model whose results match Opus on most stories. Record the result in this doc. If Haiku is close enough, use it; it is about 20 times cheaper than Sonnet.

Other API settings: keep the long fixed part of the prompt (instructions, topic list) first so it is cached between calls; set effort explicitly; turn on the API's refusal fallback.

### Costs **(Coordinator's call: visible and capped)**

Rough estimates, assuming about 8,000 input tokens and 2,500 output tokens per issue, about 180 issues a month, and about 2,000 issues for one year of backfill. Prices from the current Anthropic price list: Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50 per million input / output tokens; Batch API half price.

| Model | Per issue | Per month | 12-month backfill (batch) |
|---|---|---|---|
| Haiku 5.5 | about $0.002 | about $0.40 | about $2 |
| Sonnet 5.5 | about $0.04 | about $7 | about $40 |
| Opus 5.5 | about $0.08 | about $15 | about $80 |

Dedupe and shared articles add cents. The builder measures real numbers in the model comparison and replaces this table.

Re-running extraction over old issues (after a topic-list or prompt change) **(Spec writer's call, from the builder check):** works like the backfill. A script picks the issues (all, or a date range), shows the count and cost estimate, and waits for Mason's "yes". It uses the Batch API and its own one-time budget, not the monthly cap. Nothing re-runs old issues on its own.

Making it visible:
- Every Claude call stores model, input, cached and output tokens, and dollar cost (from a price table in code) in a `news_usage` table.
- The private news page shows cost this month, last month, and per issue.
- The connector has a tool for it (below).
- **Cap:** `NEWS_MONTHLY_BUDGET_USD` (default 25) **(Mason)**. When month-to-date cost reaches it, extraction pauses, issues keep arriving and wait, and ntfy tells Mason once. Nothing is lost; raising the cap or the new month resumes it.
- The backfill has its own estimate shown before it starts, and Mason confirms it. **(Mason: the ~$40 import is approved in principle, but the script still shows the estimate and waits for his explicit go when it runs.)**

---

## 5. Backfill **(Mason: yes, once, with his OK. Coordinator's call: 12 months)**

- **How (Spec writer's call):** Mason exports the six newsletters from Gmail with Google Takeout (Mail, one label), giving an `.mbox` file. A local script reads it and sends issues to the same intake code as the webhook, with the same duplicate check by `Message-ID`. This needs no Google app setup and gives the system no ongoing access to his Gmail.
- Before it runs, Mason applies one Gmail label to all six newsletters (the same filter that forwards them can label them).
- The script shows counts per newsletter and the cost estimate, then waits for Mason's "yes".
- Extraction for the backfill uses the Batch API and counts toward its own one-time budget, not the monthly cap.

## 6. Data and database guards **(Coordinator's call: follow hub patterns)**

Tables (names are suggestions):

| Table | Holds | Who can read |
|---|---|---|
| `news_sources` | the six newsletters (and `shared`): name, sender addresses, homepage | owner, service role |
| `news_issues` | one row per email: source, subject, dates, cleaned text, Blob path, status | owner, service role |
| `news_shared` | one row per shared URL: inbox item id, fetched text, status | owner, service role |
| `news_extraction_runs` | model, prompt version, date | owner, service role |
| `news_stories` | story records (above), with run and cluster | owner, service role |
| `news_clusters` | one row per real-world story | owner, service role |
| `news_topics`, `news_companies` | lists | owner, service role |
| `news_usage` | tokens and cost per call | owner, service role |
| **`news_trends_daily`** | day, topic or company, story count, mention count, average tone, which sources. **No text columns.** | service role (public page reads it server-side) |

Rules:
- Row-level security on every table, owner-only, like `items`. `anon` and `authenticated` get no grants on the private tables.
- No deletes on `news_issues`, `news_shared`, `news_stories`, `news_usage` (guard triggers, like the hub's). Issue text never changes after insert.
- `news_trends_daily` is derived. It can be rebuilt from the stories at any time (a materialized view, which is a stored query result refreshed on demand, or a table the job rewrites). It holds no headline, no text and no link from inside an email.
- The public page reads trends through one function that returns only `news_trends_daily` columns, called server-side with the service role, the same way `lib/now.ts` reads the now board. It never touches the private tables.
- Each migration gets a security review (the `reviewing-security` skill) and Mason's review before `supabase db push`.
- The daily hub backup adds the news tables except cleaned text, which can be rebuilt from the raw emails in Blob. **(Spec writer's call; keeps the backup small)**

## 7. Agent connector: read-only news tools **(Mason: mainly asks Claude)**

Add these tools to the existing connector at `/api/mcp/mcp`. All read only. None can trigger extraction (which spends money), change data, or send anything.

| Tool | Does |
|---|---|
| `news_search` | find stories by text, topic, company, ticker, source and date range; returns headline, topics, companies, tone, date, source, private link |
| `news_trend` | for a topic or company, counts and average tone per day, week or month over a date range |
| `news_movers` | topics and companies rising or falling most over a window, compared with the window before |
| `news_get_issue` | one issue's cleaned text and its stories (Mason's own copy) |
| `news_costs` | spend by month and model, and the current cap |

- Tool descriptions say returned text is data, never instructions.
- **No new token (Spec writer's call, from the builder check).** The connector keeps its one token, `HUB_AGENT_TOKEN`. An agent that reads newsletter text through `news_get_issue` could in theory be steered by it and then use the write tools. That is the same risk the connector already carries for item text: shared articles already put outside web text into items. The existing limits cover it: agents can only add to the inbox, edit or comment on open items, and merge duplicates; they cannot complete, delete, email, buy, book or deploy, and every write is in `audit_log`. A second read-only connector is not worth the extra sign-in surface.
- The existing test that checks the tool list exactly must be updated to the new list.
- `news_movers` and `news_trend` describe coverage ("mentions of X rose 3 times"), never advice.

## 8. Public dashboard **(Mason: public, trends only)**

### Where

- A page at `/trends` **(Spec writer's call on the path)**.
- A board tile, "What I'm reading about", that shows the top 3 rising topics with a small line of counts, and links to `/trends`. It follows the board's rules: built on `components/board/Tile.tsx`, listed in `components/board/Board.tsx` only when there is data (like the projects and bake tiles), and its span chosen so grid rows stay full.

### What it shows

- Top topics and companies over the last 30 days: story count, rising or falling (with how much), average tone shown as a word and color (for example "mostly positive").
- For one topic or company: a chart of weekly counts over the last 12 months, its tone over time, and which newsletters covered it, with dates.
- Links back to each newsletter (see below).
- A one-line note: "Counts of what six newsletters I read talked about. Not financial advice."

### What it never shows **(Mason)**

Newsletter text, quotes, headlines, Claude's headlines, summaries, the article links inside emails, or anything per story beyond topic, company, date, tone and source.

### Public links **(Spec writer's call)**

Links inside forwarded emails can carry Mason's personal tracking or unsubscribe codes. So:
- Each newsletter's public link is built from a known safe pattern for that publisher (its public web archive page for the issue, with no query string), or falls back to the newsletter's homepage.
- The builder checks each of the six publishers for a public archive. The pattern lives in `news_sources`.
- No link copied from email text reaches the public page.
- **Headline words in the address are fine (Spec writer's call, from the builder check).** Some archive addresses end in words from the issue's subject. Using that address as the link target is fine: it points readers to the writer's own page. The visible link text is only the newsletter name and date, for example "Morning Brew, Nov 3", never the subject.

### Rising and falling

"Rising" compares the last 7 days with the weekly average of the 4 weeks before. A topic needs at least a few stories to be shown as rising, so one story does not make a spike. Exact thresholds are the builder's call.

## 9. Private news page

A small page in the hub, `/hub/news`, for Mason only:
- recent issues per newsletter, with status (pending, done, failed, quarantined);
- quarantined messages, with a "view" button (needed for Gmail's confirmation);
- cost this month and the cap;
- most common suggested topics;
- a button to retry a failed issue.

It does not need to be a reader. Claude is the main way in.

---

## Env vars and secrets (Mason adds them)

- `ANTHROPIC_API_KEY`: Claude API key, Vercel Production only. **It must be made in "Mason's Individual Org"**, the Console org linked to his Claude Ultra plan, so usage draws from the monthly credits. Mason creates and adds it himself. **(Mason)**
- `RESEND_INBOUND_SECRET`: webhook signing secret (if Resend inbound is used).
- `NEWS_MONTHLY_BUDGET_USD`: optional, default 25.
- Resend account and the inbound subdomain's DNS records at IONOS (Mason adds the records; the builder lists them).
- No new Vault secret: the `news` event reuses `hub_events_url` and `hub_events_token`.

## Build order (suggested)

0. Mason runs the Google Takeout export at the start (see "Backfill"). Step 3 needs real past issues (20 for the model comparison, two weeks for the topic list), so the build should not wait two weeks for forwarded mail. Only the import itself (step 6) waits for his OK on the cost. **(Spec writer's call, from the builder check)**
1. Inbound address, webhook, raw storage, quarantine page. Test with Gmail's confirmation email, then set the Gmail filter.
2. Tables and guards (security review, Mason reviews migration).
3. Model comparison on 20 issues; choose the model; draft the topic list.
4. Extraction job, dedupe, usage and cap.
5. Connector tools.
6. Backfill (with Mason's OK on the estimate).
7. Public `/trends` page and board tile.
8. Shared articles feed.

## Left to the builder

- Table and column names, and whether trends are a materialized view or a table.
- How email becomes clean text (library choice).
- The extraction prompt, effort level, and exact output shape.
- Dedupe thresholds, and "rising" thresholds.
- Chart choices and layout of `/trends` and the tile, within the board's look.
- Batch size per job run and retry timing.
- Whether daily extraction also uses the Batch API, if the cost gap matters after measuring.

## Open questions for the builder to settle (not for Mason)

- Does Resend inbound's free tier cover about 200 emails a month, and does it accept a subdomain? Check current docs. If not, use Cloudflare Email Routing on the subdomain with a small Cloudflare Email Worker that posts to the webhook.
- Each newsletter's original sender addresses, and whether Gmail forwarding keeps the original `From` (it does today, but check the headers on the first real message).
- Which of the six publishers have a public archive page per issue, and its URL pattern.
- Vercel Blob free-tier storage: raw emails are about 100 KB each, so about 250 MB a year. Check the store's limit.
- Function time limit on the current Vercel plan, to size each job run.

## Open questions for Mason

None open. Answered 2026-11-09 **(Mason)**:
- **Budget:** API route stays, paid from his Claude Ultra API credits ($200 a month). Monthly cap $25; at the cap extraction pauses and no mail is lost. The ~$40 one-time import is approved in principle; it still shows its estimate and waits for his go at run time.
- **Address:** `news@in.masonbair.com` on the subdomain is approved.

## Builder check (2026-11-09)

A fresh builder read this doc and asked six questions. Sorted:

| Question | Sorted as | Answer |
|---|---|---|
| Can an agent read newsletter text and then write hub data? | Spec writer's call | One token, same limits as item text today. See section 7. |
| Do shared articles count in public trends? | Spec writer's call | No, private only. See section 2. |
| Companies without a verified ticker on the public page? | Spec writer's call | Shown by name, ticker hidden. See section 3. |
| Archive links whose address holds headline words? | Spec writer's call | Allowed as link target; link text is name and date. See section 8. |
| Who approves re-running extraction, under what budget? | Spec writer's call | Mason confirms an estimate; own one-time budget. See "Costs". |
| Budget, subdomain, and when past emails arrive | Mason's (first two); Spec writer's call (timing) | Mason answered both (see "Open questions for Mason"). Takeout export moves to step 0. |
