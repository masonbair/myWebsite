# Ideas Lab: design

Date: 2026-11-09. Written from Mason's decisions, passed on by the coordinator.

This is a new feature of the hub (project 2, live). Read `docs/superpowers/specs/2026-11-03-masonbair-personal-hub-design.md` first; this doc uses its words and rules. The Claude API job, its cost log and its cap follow `docs/superpowers/specs/2026-11-09-newsletter-trends-design.md` (sections 4 and 6).

Tags used below:
- **(Mason)**: Mason decided this.
- **(Coordinator's call)**: the coordinator decided this for Mason. The builder follows it and flags it if it causes trouble.
- **(Spec writer's call)**: a smaller call made while writing this doc. Same rule as the coordinator's calls.

## Intent

Mason gets ideas in the middle of conversations: an app, a business, a feature, a trip, a thing to bake. He often forgets them. When he does keep one, it sits in a list and nobody ever looks at it again. **(Mason)**

He wants two things:

1. **Catch every idea**, including ones he only says out loud inside a longer voice memo or recording session.
2. **Make each idea better and bring it back.** An expert reviewer reads each new idea and tells him honestly whether it is good, how to make it better, and what it could grow into. Then the idea comes back to him on his phone calendar a few times, so it is not forgotten. **(Mason)**

## Goals

- An idea said into the phone (hub quick capture, voice) or into a HiNote recording ends up as its own item in the hub's Ideas list, with no sorting by Mason.
- An idea mentioned inside a longer memo is found and pulled out as a separate idea item that links back to the memo it came from. The memo stays as it is.
- Within about an hour of capture, each new idea has a written review by Claude (verdict, how to improve it, build-offs).
- A private Ideas Lab page in the hub lists ideas and shows each idea's review.
- Each idea comes back on Mason's phone calendar at +3 days, +2 weeks and +2 months, then stops.
- The cost is logged per review, shown to Mason, and capped per month.
- Claude (through the hub connector) can read ideas and their reviews.

## Non-goals

- Building anything. The reviewer suggests a "weekend version"; it never starts one, opens a repo, or makes a task by itself.
- Sorting the rest of the inbox. To-dos and notes in a memo stay for the worker's memo split (project 5). The Ideas Lab only pulls out ideas.
- Ideas from email, Granola meetings, or shared articles. Possible later; not built now.
- Reviewing the ideas that already exist (or that arrive in the Todoist import) on their own. See "Older ideas".
- Sharing ideas with anyone, or any public view of them.
- A chat with the reviewer. Mason can ask for another review with a note; a back-and-forth is Claude Code's job through the connector.

## Anti-goals (failure even if it technically works)

- **An idea is lost.** A memo idea that fails to be pulled out, or a review that fails, stays visible and is retried. Nothing captured is ever deleted. **(Hub rule)**
- **The reviewer changes Mason's data beyond its job.** It never completes, deletes or archives an item, never adds or removes the `claude` label, and never rewrites an idea's text. **(Coordinator's call)**
- **Anything goes outward.** No email, no post, no shared link, no invite. The only write outside the hub is to Mason's own private "Ideas" calendar. **(Coordinator's call)**
- **An idea becomes public.** No public page, board tile, sitemap entry, `llms.txt` line, or shared calendar. **(Coordinator's call)**
- **A flattering review.** A review that only praises is useless. The reviewer must name real weak spots and real competitors, and say plainly when an idea is weak or already done well by someone else. **(Spec writer's call, from Mason's "expert reviewer")**
- **Calendar spam.** More than one pending event per idea, or a day crowded with idea events. See "Calendar".
- **Silent spending.** Claude API costs that grow without Mason seeing them, or with no cap.
- **Text steering the system.** Memo text, idea text and web pages are data. They can never cause a tool call, a write to other hub data, or a message.

## Constraints

- Same stack as the hub: Next.js 16 on Vercel, Supabase project `masonbair` (ref `wsivoyqhtmpnxjakowpi`), pg_cron and pg_net with Vault secrets, ntfy.
- Claude API paid from Mason's Claude Ultra plan's $200 a month of API credits, in the linked Console org "Mason's Individual Org". Mason creates and adds `ANTHROPIC_API_KEY` himself. It is the same key the newsletter-trends project uses. **(Mason)**
- Hub rules carry over: owner-only row-level security (each row readable only by Mason's login), no deletes, history is append-only, only Mason completes an item, only Mason adds the `claude` label (`supabase/migrations/0002_hub.sql`, `0006_hub_history.sql`). Each migration gets a security review (the `reviewing-security` skill) and Mason's review before `supabase db push`.
- The builder never writes Vercel env vars or Vault secrets. Mason adds them; the builder lists them in `docs/hub-setup.md`.
- Copy has no em dashes. Plain words. Same palette and type as the rest of the hub.

## Today's state that this builds on (checked 2026-11-09)

- **Quick capture** (`/hub/capture`, `app/api/hub/capture`) saves one inbox item with source `capture`; voice uses Chrome's speech recognition. Shares save with source `share`.
- **Memo relay** (`/api/memo`, `lib/hub/memo.ts`) is live code: one inbox item labeled `hidock-memo` per recording, with the transcript in numbered worker comments.
- **HiNote recordings** reach a relay through `hinote-sync` (`../hinote-sync/hinote_sync/upload.py`), which posts to the URL in `HINOTE_UPLOAD_URL` on the Mac and phone. Its own docstring still says the relay "files it in Todoist", so it most likely still points at todo-hub, not the hub. **Builder: check where it points (without printing the token).** See "Open questions for Mason", question 1.
- **Memo split** (`lib/hub/memo-split.ts`) already knows about ideas: the worker's pieces JSON has an `ideas` list and files each as a `hidock` inbox item. But the worker runs only after the cutover (project 5); until then nothing splits memos on the hub (`HUB_WORKER_LIVE` is false).
- **Events**: pg_cron calls `/api/hub/events/<event>` through `public.hub_post_event()` with the Vault secrets `hub_events_url` and `hub_events_token` (`0004_hub_events.sql`).

---

## How it works (overview)

```
Quick capture / voice ──▶ inbox item (source: capture) ─┐
HiNote recording ──▶ /api/memo ──▶ memo item (hidock-memo) ─┤
"Idea" button on capture ──▶ item in Ideas list ─────────┤
                                                         ▼
pg_cron every 15 min ──pg_net──▶ /api/hub/events/ideas
   1. Detect: new captures and memos ▶ Claude Haiku finds ideas
        ▶ new idea items (linked to the source) or a capture moved to Ideas
   2. Review: each idea with no review ▶ Claude Opus (+ web search)
        ▶ idea_reviews row (version 1), cost logged
   3. Resurface: ideas due tomorrow ▶ Google Calendar event on the "Ideas" calendar
                                                         │
          ┌──────────────────────────────────────────────┴───────────┐
   /hub/ideas list + /hub/ideas/<id> page                MCP connector: read-only idea tools
   (Mason only)                                          (owner token)
```

---

## 1. Capture **(Mason: phone dictation and HiNote recordings)**

### Quick capture and voice

- The capture screen keeps working exactly as today. **(Spec writer's call)** It gains one extra button, **"Save as idea"**, next to Save. It files the item straight into the Ideas list with the `idea` label. No detection step is needed for it.
- A plain capture (Save) still lands in the inbox. The detection step (section 2) reads it. If the whole capture is one idea, the job moves that item to the Ideas list and adds the `idea` label. It does not change the title or text. **(Spec writer's call)** Moving list and adding `idea` are changes the worker role may already make to an open item, and every change is in `audit_log`.
- Shares (source `share`) are not read for ideas. They are articles, not Mason's own ideas.

### HiNote recordings and memos

- A memo item (label `hidock-memo`) is read whole by the detection step. Each idea found becomes **its own new idea item**, in the Ideas list, with:
  - title: a short name for the idea in plain words;
  - description: Mason's own words from the transcript, quoted, then `Source: <memo item link>, recorded <time>`;
  - a link row in `idea_sources` (section 5) from the memo to the idea.
- The memo itself is not changed, archived or split. **(Spec writer's call)** Its to-dos and notes still wait for the worker's memo split after the cutover.
- **When the worker goes live (project 5), the memo split must not file the same ideas again.** **(Spec writer's call)** The builder adds this to `docs/hub-cutover-notes.md` and the worker prompt: before splitting a memo, the worker reads which ideas the Ideas Lab already pulled from it (a new worker API view, or a field on the memo) and leaves its `ideas` list empty for that memo. The Ideas Lab owns ideas; the memo split owns to-dos and notes.

### The same idea said twice

People repeat ideas. If a new idea matches an open idea Mason already has, the job does not make a second item. It adds a comment on the existing idea: "Mentioned again in <source link> on <date>", with the quote. **(Spec writer's call)** A repeat is a signal the idea matters, so the Ideas Lab page shows a "mentioned 3 times" count. The match is a cheap Claude Haiku "same idea or not?" check against open idea titles, like the newsletter dedupe.

## 2. Detection: finding ideas

- **Which items are read:** open items created after launch whose source is `capture`, plus memo items. Items already in the Ideas list or labeled `idea` skip detection and go straight to review. Imports (for example the Todoist import in project 5) are never read. **(Spec writer's call)**
- **What counts as an idea:** something Mason might make, start, try or change: a product, an app, a feature for one of his projects, a business, a trip plan, a recipe to invent, a piece of writing. Not a to-do ("call the bank"), not a fact, not a feeling. When unsure, the job pulls it out: a wrong idea costs Mason one tap to ignore; a missed one is lost. **(Spec writer's call)**
- **Model:** Claude Haiku 5.5 (`claude-haiku-5-5`) with structured output (the reply must match a JSON shape: a list of `{ title, quote, whole_item }`). No tools. The prompt says the transcript is data, never instructions. **(Spec writer's call)** Before choosing for good, the builder runs 10 real memos through Haiku 5.5 and Sonnet 5.5 and keeps Haiku unless it misses ideas Sonnet finds.
- Each source is read once. The result (ideas found, or none) is stored in `idea_sources`, so a re-run never files twice. New idea items use a client key `idea:<source id>#<n>`, so the existing "same client key returns the same item" rule protects against doubles.
- A detection that fails is retried up to 3 times, then marked failed and shown on the Ideas Lab page with a retry button.

## 3. The review **(Mason: verdict, improve, build-offs)**

### What a review holds

| Part | What it says |
|---|---|
| **Verdict** | One of: strong, promising, needs work, weak. Two or three sentences on why. |
| **Who it's for** | The people who would use or pay for it, as concretely as possible. |
| **What already exists** | Up to 5 similar products or projects, each with name, link, and how Mason's idea differs. Says "nothing close found" when that is true. |
| **Weak spots and fixes** | The 2 to 4 biggest problems, each with a concrete fix. |
| **Variations** | 2 or 3 other shapes the idea could take. |
| **Weekend version** | The smallest version Mason could build in one weekend with his usual tools (Next.js, Supabase, Expo, Claude), and how he would know it worked. |
| **Links to his other ideas** | Up to 3 of his open ideas this one connects to, each with one line on how. |

Shown on the idea's page. Stored as structured data (one JSON column) plus the model, prompt version, date and cost.

### How the reviewer is set up **(Spec writer's call)**

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), effort `high`. Volume is small (tens of ideas a month) and the review is the whole point, so quality wins over price here. If cost runs high, the builder may compare Sonnet 5.5 on 10 real ideas and switch only if the reviews hold up side by side.
- **What it is given:** the idea text and its source quote; a short fixed "about Mason" block (traveler and digital nomad, baker, builds with AI agents, his stack) kept first in the prompt so it is cached; and the titles and ids of his other open ideas, so it can link them. The links it returns are checked against real idea ids; unknown ids are dropped.
- **Output** is checked against the review shape. A reply that fails is retried once, then marked failed and shown with a retry button.
- **The reviewer has no hub tools.** It runs as a plain API call inside the job. The job code, not Claude, writes the review row. So the reviewer cannot touch items, labels, other tables, or the calendar, whatever a web page or memo says.
- Turn on the API's refusal fallback (`fallbacks: "default"`), as the claude-api guidance says for Opus 5.5.

### Web search for "what already exists" **(Coordinator asked to decide; Spec writer's call: yes, limited)**

The reviewer may use the Claude API's web search server tool (`web_search_20260209`, a search Anthropic runs during the call). Without it, "what already exists" is only Claude's memory, which is months old and often wrong about small products.

- **Limit:** `max_uses: 5` searches per review. Only web search, not web fetch.
- **Cost:** about $10 per 1,000 searches, so at most about 5 cents per review, plus the tokens of the results it reads (estimated in "Costs"). The builder checks the live price list.
- **Safety:** web pages are untrusted text. They can try to steer the model. The worst they can do here is make a review wrong or odd, because the reviewer has no other tool and its output only lands in a review row Mason reads. Links in the review open in a new tab with `rel="noopener noreferrer"`; the hub never fetches them.
- **Privacy:** search queries carry the gist of an idea out to the search provider, through Anthropic. That is the same kind of exposure as sending the idea to the API at all. Each idea has a "no web search" switch, and `IDEAS_WEB_SEARCH=off` turns it off for all. With it off, "what already exists" says it is from memory only.
- **If web search and structured output do not work in one call** (the builder checks), split it into two calls: a short search call that returns a list of similar things with links, then the review call with no tools and structured output.

### Re-reviews are new versions **(Coordinator's call)**

- "Review again" on the idea page asks for a new review, with an optional note from Mason ("I changed it to target bakers", "focus on cost").
- Each review is a new row with the next version number. Old versions are never changed or deleted. The page shows the newest and lists earlier ones.
- Agents cannot ask for a review (it spends money). Only Mason's button and the job's first review do.

### Older ideas **(Spec writer's call)**

Ideas that exist before launch, and ideas brought in by the Todoist import, are not reviewed on their own. Each shows a "Review" button. If Mason wants them all done, a script lists the count and a cost estimate and waits for his "yes", like the newsletter backfill.

## 4. The background job **(Coordinator asked to choose; Coordinator's call: Vercel function + Claude API, called by pg_cron)**

| Option | For | Against |
|---|---|---|
| **Vercel function calling the Claude API, started by pg_cron through pg_net** (chosen) | The hub's existing pattern for reminders and backups, and the one newsletter trends uses. Plain code, testable with a fake API, logs exact tokens and cost per call. Works today. | Needs `ANTHROPIC_API_KEY`. |
| The cloud worker (Claude Code routine) | Uses the plan, no API key. | Not live on the hub until project 5. Runs about 4 times a day, so an idea could wait 6 hours, past the ~1 hour goal. A full agent session for one fixed call is slower, harder to test, and its cost is hard to see. Its role also allows more than the reviewer should have. |

Shape:
- New event `ideas` in the existing events route (`/api/hub/events/[event]`), same bearer token and Vault secrets. A pg_cron job calls it every 15 minutes. **(Spec writer's call)** That keeps capture to review well inside an hour, with room for one failed run.
- Each run does three steps in order: detect (section 2), review (section 3), resurface (section 6). It stops early to stay inside the function time limit; the next run picks up the rest. Reviews are claimed with one atomic update, like `hub_claim()`, so two runs never review the same idea.
- The job writes as actor `{ kind: "worker", runId: "ideas-lab" }`, so `audit_log` shows it. Its code goes through a small interface with only the calls it needs: read items and comments, add an idea item, move a capture to Ideas and add `idea`, add a "mentioned again" comment, write its own tables. There is no complete, archive, delete or label-`claude` call in it, and the database triggers refuse those anyway.
- A daily ntfy message lists failed detections or reviews, if any. No ntfy per review; the calendar is the reminder channel. **(Spec writer's call)**

## 5. Data and database guards **(Coordinator's call: follow hub patterns)**

Ideas stay ordinary hub items (list `ideas`, label `idea`), so lists, search, comments, history and backups keep working. New tables (names are suggestions):

| Table | Holds | Rules |
|---|---|---|
| `idea_sources` | one row per source read by detection: source item id, status, ideas found (item ids), model, date | append-only; status changes allowed |
| `idea_reviews` | one row per review version: idea item id, version, review JSON, model, prompt version, Mason's note, date | **insert only**: no update, no delete (guard triggers, like `items_history`) |
| `idea_settings` | per idea: reminders stopped, no web search, review status | owner and service role |
| `idea_resurface` | one row per planned calendar return: idea id, step (1, 2, 3), due date, Google event id, status (planned, sent, closed, skipped) | no deletes |
| `ai_usage` | one row per Claude call: feature (`ideas`, `news`), model, input, cached and output tokens, web searches, dollar cost, idea or issue id | insert only |

- **One usage table for every Claude feature (Spec writer's call).** If newsletter trends has not been built yet, both use `ai_usage` with a `feature` column instead of `news_usage`; each feature keeps its own cap. If `news_usage` already exists, the Ideas Lab adds `ideas_usage` the same way and the two are merged later. The builder checks with whoever builds newsletter trends.
- Row-level security on every table, owner-only, like `items`. `anon` gets nothing. `authenticated` reads only through the owner check.
- No deletes and no truncates on any of these tables (the `hub_no_delete` triggers).
- The daily hub backup and `scripts/hub-restore.ts` add the new tables.
- Each migration gets a security review and Mason's review before `supabase db push`.

## 6. Calendar: bringing ideas back **(Mason: phone calendar, Google Calendar)**

### Schedule **(Coordinator's call; Mason did not pick)**

- Each reviewed idea comes back at **+3 days, +2 weeks and +2 months** from capture. Then it stops.
- It stops early when Mason acts on it: promotes it to a task, marks it done, or taps "Stop reminders".
- "Review again" restarts the schedule from that day, since the idea has changed.
- An idea with no review yet (cap reached, or failed) still comes back on time; the event says the review is waiting.

### What an event looks like **(Coordinator's call: short, links to the idea's page)**

- Title: `Idea: <idea title>`.
- Description: the verdict in one line, the weekend version in one line, and the link `https://masonbair.com/hub/ideas/<id>`.
- A 10-minute event at 9:00 in Mason's current time zone (the same zone logic as hub reminders: the phone's latest place ping if a week old or less, else `HUB_TIME_ZONE`), with one pop-up reminder at the start. **(Spec writer's call)**
- At most 3 idea events per day. Extra ones move to the next free day. **(Spec writer's call)**
- Event visibility is private. Note that the title shows in the phone's notification and lock screen.

### Only create and update, never delete **(Coordinator's call)**

- An event is created **the day before** it is due, not all at once at capture. **(Spec writer's call)** So there is never a pile of future events to cancel when Mason acts on an idea.
- If Mason acts on an idea after its next event exists, the job updates that event: title becomes `Idea (closed): <title>` and its pop-up reminder is removed. It is not deleted.
- The job writes only to the "Ideas" calendar it created. It never reads, changes or invites to any other calendar.

### Google access **(Coordinator's call: OAuth refresh token stored server-side, minimal scope, revocable)**

Mason's Google Calendar connector in claude.ai belongs to Claude's apps, not to the site, so a Vercel job cannot use it. The site needs its own Google access.

- **Scope:** `https://www.googleapis.com/auth/calendar.app.created` only. It lets the app make its own secondary calendars and manage events on them, and nothing else: it cannot see Mason's other calendars or events. **(Spec writer's call)**
- **Connect:** a "Connect Google Calendar" button on `/hub/ideas/settings` (owner only) sends Mason through Google's consent screen (offline access, so Google returns a refresh token). The callback checks the owner's session and a one-time `state` value, stores the refresh token, creates the "Ideas" calendar if it does not exist, and stores its id.
- **Where the token lives:** Supabase Vault, written and read only through two security-definer functions that only the service role may call. Never in a table the API exposes, never in logs, never sent to the browser. **(Spec writer's call)** Vault is already used for the events secrets.
- **Google project:** Mason makes a Google Cloud project with an OAuth client (web app) whose redirect URL is `https://masonbair.com/hub/ideas/google/callback`. The builder lists the clicks in `docs/hub-setup.md`. The app must be set to "In production", not "Testing": Google expires refresh tokens of testing apps after 7 days. An unverified app is fine for Mason's own account; he will see a warning screen once. The builder checks whether this scope needs Google's verification and says so.
- **Revoke:** two ways, both must work.
  1. "Disconnect" on the settings page: calls Google's revoke endpoint, then blanks the Vault secret and records the time. Nothing is deleted.
  2. Mason removes the app at myaccount.google.com/permissions. The job's next call gets `invalid_grant`; it marks Google as disconnected, sends one ntfy message, and stops calendar work. Ideas and reviews keep working.
- **While disconnected**, due returns are marked `skipped` and the Ideas Lab page shows them as due. Reconnecting does not send the missed ones in a burst; the next step is planned as normal. **(Spec writer's call)**
- **Phone setup:** a new calendar can start hidden on Android. After connecting, Mason opens Google Calendar on the phone, Settings, and turns on sync for "Ideas". The settings page says this.

### Rejected alternative: a calendar feed link (ICS subscription)

The hub could serve a secret calendar link Mason subscribes to. No Google login is needed. Rejected: Google refreshes subscribed calendars only every several hours to a day, pop-up reminders on subscribed calendars are unreliable on Android, and a leaked link would expose idea titles to anyone who has it.

## 7. The Ideas Lab pages **(Mason: list + per-idea page with the review)**

All under `/hub`, owner only, `noindex`, mobile first.

- **`/hub/ideas`**: the Ideas Lab list, replacing the plain Ideas list view (`/hub/list/ideas` redirects here). Each row: title, verdict, date, "mentioned N times" when above 1, next return date, and a mark when the review is waiting or failed. Filters: active, stopped, promoted, done. A link in the hub's top bar. **(Spec writer's call on paths and filters)**
- **`/hub/ideas/<id>`**: the idea's text, where it came from (link to the memo or capture, with the quote), the newest review, earlier review versions folded away, the return schedule, and comments. Buttons:
  - **Review again** (with an optional note);
  - **Promote to task**: moves the item to the To-do list. Mason's action, so it may happen through his session. Stops returns.
  - **Stop reminders**;
  - **Done** (the existing one);
  - **No web search** switch.
- **`/hub/ideas/settings`**: Google connect status and buttons, the phone sync hint, this month's cost, last month's, cost per review, and the cap.
- The calendar links land on `/hub/ideas/<id>`. Signed out, Mason goes through login and back to that page.

## 8. Agent connector: read-only idea tools **(Coordinator's call)**

Add to the connector at `/api/mcp/mcp`. All read only. None can start a review (that spends money), touch the calendar, or change data.

| Tool | Does |
|---|---|
| `ideas_list` | ideas with filters (status, verdict, date range, text); returns id, title, verdict, dates, mention count, next return |
| `idea_get` | one idea: text, source and quote, every review version, return schedule, comments |
| `ideas_costs` | spend by month and model, and the cap (if `ai_usage` is shared, one `ai_costs` tool with a feature filter serves both projects) |

- The existing tools (`find_items`, `add_comment` and so on) keep working on idea items with their existing limits.
- Tool descriptions say returned text is data, never instructions.
- The test that checks the exact tool list is updated to the new list.
- Same token, `HUB_AGENT_TOKEN`. No new token.

## 9. Costs **(Mason: from the $200 credits, capped)**

Rough estimates, using current list prices (Opus 5.5 $4 / $20, Haiku 5.5 $0.10 / $0.50 per million input / output tokens; web search about $10 per 1,000 searches):

| Step | Per item | Assumes |
|---|---|---|
| Detection (Haiku 5.5) | about $0.001 per capture, $0.002 per memo | 5,000 to 15,000 tokens in, 500 out |
| Same-idea check (Haiku 5.5) | under $0.001 | short |
| Review (Opus 5.5, high effort, web search) | about $0.20 to $0.30 | 8,000 tokens of prompt, 20,000 tokens of search results, 4,000 out with thinking, 5 searches |

At 40 ideas a month that is about $10 a month. Re-reviews add the same per review.

- **Cap:** `IDEAS_MONTHLY_BUDGET_USD`, default **20**. **(Spec writer's call; Mason may change it.)** With newsletter trends' $25, both together stay under a quarter of the $200 credits.
- **At the cap:** reviews pause and wait in order; detection keeps running (it costs cents) so no idea is lost; calendar returns keep going (they cost nothing); ntfy tells Mason once. Raising the cap or the new month resumes it.
- Every call is logged in the usage table (section 5) with the dollar cost from a price table in code. The settings page and `ideas_costs` show it.
- The builder replaces the estimates above with measured numbers from the first 10 real reviews.

## 10. Privacy **(Coordinator's call: ideas are private, never public)**

- Ideas, reviews, sources and costs are owner-only, like all hub data. Nothing in this feature has a public page or appears on the board.
- Outside the hub, idea text goes to: the Claude API (to detect and review), web search queries (unless turned off), and Mason's own private "Ideas" calendar. Nowhere else.
- No idea text in server logs beyond ids and error codes.

---

## Env vars and secrets (Mason adds them)

- `ANTHROPIC_API_KEY`: shared with newsletter trends; made in "Mason's Individual Org". **(Mason)**
- `IDEAS_MONTHLY_BUDGET_USD`: optional, default 20.
- `IDEAS_WEB_SEARCH`: optional, `off` turns web search off for all reviews.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`: from Mason's Google Cloud project.
- The Google refresh token is not an env var: the connect flow stores it in Vault.
- No new events secret: the `ideas` event reuses `hub_events_url` and `hub_events_token`.

## Build order (suggested)

1. Tables and guards (security review, Mason reviews the migration).
2. Review job on ideas from the "Save as idea" button, with cost log and cap. Model check on 10 real ideas.
3. Ideas Lab list and idea page.
4. Detection on captures and memos, the same-idea check, and the cutover note for the memo split.
5. Google connect, the "Ideas" calendar, resurfacing.
6. Connector tools.

Steps 2 and 3 already give Mason value; the calendar can follow.

## Left to the builder

- Table and column names; whether review status lives in `idea_settings` or is derived.
- The detection and review prompts, exact JSON shapes, and effort levels.
- Batch size per job run, retry timing, and the function time limit on the current Vercel plan.
- Page layout and look, within the hub's style.
- How the worker learns which memo ideas are already filed (new worker view or a field), as long as the memo split does not double them.
- Whether "Save as idea" is a second button or a toggle.

## Later / related (not in this spec)

- **"Mason-bot" for visitors.** Mason likes the idea of a public chat box on masonbair.com that answers visitors' questions about him from public data only, and logs each question to his inbox. It is a separate project with its own design (public data only, abuse limits, cost cap). It must never read the private hub. Not part of the Ideas Lab.
- **Bread and bake features** are on the back burner while Mason travels.
- Ideas from email, Granola meetings or shared articles could use the same detection step later.

## Open questions for Mason

(Filled in after the builder check, below.)

## Builder check

(Filled in below.)
