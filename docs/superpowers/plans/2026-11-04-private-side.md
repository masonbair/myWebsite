# Private Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give masonbair.com a private side, behind Mason's login, that holds his tasks, ideas and notes in his own Supabase database, with quick capture from his phone, todo-hub's worker, memo relay and skill ported onto it, and one agent connector that enforces the safety rules.

**Architecture:** Everything lives in the existing Next.js app (built on branch `redesign-public-board`). One `hub` core module owns the data rules; the private pages, the worker's HTTP API, the memo relay and the MCP connector all go through it. Postgres triggers repeat the most important rules (nothing is deleted; only Mason completes) so a bug in app code cannot break them. Todoist keeps running untouched; nothing live is switched over in this project.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres, Auth, RLS, pg_cron, pg_net), `@supabase/ssr`, `mcp-handler` + `@modelcontextprotocol/sdk` + `zod`, Vitest, Playwright, ntfy for phone notifications (already used by todo-hub).

**Spec:** `docs/superpowers/specs/2026-11-03-masonbair-personal-hub-design.md` (section "2. Private side", plus Anti-goals and Constraints). Source being ported: `../todo-hub` (`src/`, `api/`, `worker/PROMPT.md`, `skills/todo-hub/SKILL.md`).

---

## Decisions

1. **Sign-in: GitHub, one allowed user, `masonbair`. (Mason)** The owner check compares GitHub's numeric user id (looked up once from the `masonbair` login and stored in `HUB_OWNER_GITHUB_ID`), because a username can be renamed.
2. **Agents: Claude Code and the cloud worker only, by secret token. (Mason)** No claude.ai connector login flow; there is no Task 12.
3. **Live as soon as it ships, not a test bed. (Mason)** The private side holds real data from its first production deploy. Todoist keeps running in parallel until project 5, so items captured in one do not appear in the other. Because the database is live: tests, seeds and resets run only against local Supabase; the live project only ever receives migrations through `supabase db push` after they pass locally; and a daily backup runs (Task 8).
4. **Voice: a mic button using Chrome's speech recognition, with a one-line note on screen that the audio goes to Google. (Mason)**
5. **The phone collector app (project 3) signs in with GitHub too and lives in this repo under `apps/collector`. (Coordinator's call)** Task 3 therefore supports a mobile sign-in redirect as well as the web one.
6. **Until the worker moves over (project 5), nothing in the cloud works on hub items. (Claude's call)** The Approve button is hidden unless `HUB_WORKER_LIVE=true`, so an approved item can't sit unnoticed.

---

## Global Constraints

- Free or nearly free services only. No paid Supabase add-ons; use the existing `masonbair` project (ref `wsivoyqhtmpnxjakowpi`).
- Only Mason can see or change private data. Signups are turned off after Mason's first sign-in.
- Never send email. Never spend money or book anything. Never delete or complete a task (agents and the worker). Never merge or deploy code. These are enforced in code, not only in prompts.
- Nothing captured is ever deleted. Anything that can't be classified stays in the inbox. Duplicates are merged, never doubled.
- Exact coordinates never reach the server, the database or a page.
- Labels carried over exactly: `todo`, `idea`, `thought`, `claude`, `claude-working`, `claude-done`, `claude-question`, `laptop`, `hidock`, `hidock-memo`, `to-schedule`, `suggested`, plus project labels (keys of `worker/projects.json`).
- Task states: `open`, `done`, `archived`. `archived` is only for merged duplicates and split HiDock memos, and always carries a note pointing at the surviving item.
- Todoist keeps running untouched. No existing capture path (memo uploads, Granola sweep, the installed todo-hub skill, the cloud routine) is switched in this project; that is project 5. The private side's own capture screen is live from the first production deploy.
- The live Supabase project gets migrations only (`supabase db push`, after local tests pass). Never run `supabase db reset`, seed scripts, or test suites against it.
- Secrets live only in `.env.local` (gitignored) and Vercel env vars. Mason adds Vercel env vars himself; the builder never writes them.
- Copy has no em dashes. Plain words. Same palette and type as the public site.

## Review Focus

1. **The worker or an agent tries to complete or delete an item** (through the MCP connector, the worker API, or a direct service-role SQL call). Expected: refused every time; the item is unchanged. Tests in Tasks 1, 2 and 9.
2. **Capture on a flaky phone connection** (offline, double tap, retry). Expected: the item is saved exactly once, never lost. Tests in Task 5.
3. **Two worker runs claim the same approved item at once.** Expected: exactly one wins. Test in Task 6.
4. **Someone else signs in with GitHub.** Expected: they see nothing and can change nothing. Tests in Tasks 1 and 3.
5. **The same HiDock memo is uploaded twice** (phone and Mac, or a retry). Expected: one inbox item. Test in Task 7.
6. **The live database loses data** (a bad migration or a mistaken write). Expected: yesterday's snapshot exists and restores. Test in Task 8.

---

## File structure

```
supabase/migrations/0002_hub.sql        tables, RLS, guard triggers, hub_claim()
supabase/migrations/0003_hub_events.sql pg_cron + pg_net jobs (reminders, approval fire)
supabase/tests/hub_guards.sql           SQL checks for the triggers and RLS
lib/hub/types.ts                        Item, Comment, Actor, ItemQuery, NewItem, ItemPatch
lib/hub/rules.ts                        who may do what (assertAllowed)
lib/hub/store.ts                        HubStore interface + createHubStore(client, actor)
lib/hub/lifecycle.ts                    ported from todo-hub src/lifecycle.ts
lib/hub/memo.ts, memo-split.ts          ported from todo-hub
lib/hub/schedule.ts, late-migrate.ts    ported from todo-hub
lib/hub/notify.ts                       ported ntfy client
lib/hub/cli.ts, bin/hub                 worker CLI, talks to /api/hub/worker over HTTPS
lib/auth/owner.ts                       requireOwner(), owner GitHub id check
lib/supabase/server.ts, browser.ts      session client (Mason) and service client
proxy.ts                                gate for /hub and /api/hub (Next 16 name for middleware)
app/hub/...                             private pages (inbox, lists, item, capture, now)
app/hub/manifest.webmanifest/route.ts   installable app manifest scoped to /hub
app/api/hub/worker/[...op]/route.ts     worker API (bearer HUB_WORKER_TOKEN)
app/api/hub/events/[event]/route.ts     reminders + approval fire, called by pg_net
app/api/memo/route.ts                   memo relay (bearer MEMO_UPLOAD_TOKEN)
app/api/mcp/[transport]/route.ts        agent connector (bearer HUB_AGENT_TOKEN)
hub/worker/PROMPT.md, projects.json     worker prompt rewritten for the new store
hub/skills/hub/SKILL.md                 Claude Code skill rewritten for the connector
tests/unit/hub/*.test.ts                unit tests with tests/unit/hub/fake-store.ts
tests/e2e/hub-*.spec.ts                 browser tests
```

---

### Task 1: Database schema, row-level security and guard triggers

**Files:**
- Create: `supabase/migrations/0002_hub.sql`, `supabase/tests/hub_guards.sql`
- Test: `supabase/tests/hub_guards.sql` (run with `supabase test db`), against local Supabase (`supabase start`, needs Docker; if Docker is missing, stop and tell the coordinator).

**Interfaces:**
- Produces tables `hub_owner(user_id uuid primary key)`, `items`, `comments`, `hub_state(key text primary key, value jsonb, updated_at)`, `memo_files(file text primary key, recorded timestamp, device text, item_id uuid, accepted_at timestamptz)`, `audit_log(id bigint identity, actor text, action text, item_id uuid, detail jsonb, at timestamptz)`.
- `items`: `id uuid pk default gen_random_uuid()`, `title text not null`, `description text not null default ''`, `labels text[] not null default '{}'`, `list text not null default 'inbox' check (list in ('inbox','todo','ideas'))`, `state text not null default 'open' check (state in ('open','done','archived'))`, `due_date date`, `due_time time`, `archived_reason text check (archived_reason in ('merged','memo-split'))`, `merged_into uuid references items(id)`, `source text not null`, `client_key text unique`, `created_at`, `updated_at`, `completed_at`.
- `comments`: `id uuid pk`, `item_id uuid not null references items(id)`, `body text not null`, `author text not null check (author in ('mason','worker','agent'))`, `created_at`.
- SQL function `is_owner() returns boolean` (`auth.uid()` is in `hub_owner`).
- SQL function `hub_claim(p_item uuid, p_stale interval default '2 hours') returns boolean`: one atomic `update ... where labels @> '{claude}' and (not labels @> '{claude-working}' or updated_at < now() - p_stale)` that swaps the status labels to `claude-working`; true when a row changed.

- [ ] **Step 1: Write the failing SQL checks** in `supabase/tests/hub_guards.sql` (pgTAP):
  - `delete from items` raises, for every role including `service_role`.
  - As `service_role` (no `auth.uid()`): `update items set state='done'` raises; `state='archived'` with `archived_reason is null` raises; `state='archived', archived_reason='merged', merged_into=<other id>` succeeds; `archived_reason='merged'` with `merged_into` null raises.
  - As the owner (`set local request.jwt.claims` to the owner's uid): `state='done'` succeeds and sets `completed_at`.
  - As a different authenticated uid: `select count(*) from items` is 0; insert raises.
  - `anon` and `authenticated` have no grants on `hub_state`, `memo_files`, `audit_log`.
  - Two `hub_claim` calls on the same approved item: first true, second false.
- [ ] **Step 2: Run** `supabase test db`. Expected: FAIL (tables missing).
- [ ] **Step 3: Write `0002_hub.sql`.** RLS on every table. `items` and `comments` policies: `using (is_owner()) with check (is_owner())`. `hub_state`, `memo_files`, `audit_log`, `hub_owner`: RLS on, no policies, `revoke all from anon, authenticated`. Triggers: `items_no_delete` (before delete, always raise), `items_guard_state` (before update: moving to `done` or from `done` back to `open` requires `is_owner()`; moving to `archived` requires a non-null `archived_reason`, and `merged_into` when the reason is `merged`; set `updated_at`, and `completed_at` on done). Comments: same no-delete trigger. Leave the leaderboard table alone.
- [ ] **Step 4: Run** `supabase test db`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(hub): schema, rls and guard triggers`.

### Task 2: Core types, rules and store

**Files:**
- Create: `lib/hub/types.ts`, `lib/hub/rules.ts`, `lib/hub/store.ts`, `lib/supabase/server.ts`
- Test: `tests/unit/hub/rules.test.ts`, `tests/unit/hub/store.test.ts`, `tests/unit/hub/fake-store.ts`

**Interfaces:**
- Consumes: Task 1 tables and `hub_claim`.
- Produces:
  - `type Actor = { kind: "mason" } | { kind: "worker"; runId: string } | { kind: "agent"; client: string }`
  - `type Item = { id: string; title: string; description: string; labels: string[]; list: "inbox" | "todo" | "ideas"; state: "open" | "done" | "archived"; due: { date: string; time: string | null } | null; mergedInto: string | null; source: string; createdAt: string; updatedAt: string; url: string }` (`url` = `https://masonbair.com/hub/item/<id>`)
  - `type Comment = { id: string; itemId: string; body: string; author: Actor["kind"]; createdAt: string }`
  - `type ItemQuery = { list?: Item["list"]; state?: Item["state"]; withLabels?: string[]; withoutLabels?: string[]; updatedBefore?: string; limit?: number }`
  - `type NewItem = { title: string; description?: string; labels?: string[]; list?: Item["list"]; due?: Item["due"]; source: string; clientKey?: string }`
  - `type ItemPatch = Partial<Pick<Item, "title" | "description" | "labels" | "list" | "due">>`
  - `type HubAction = "read" | "add" | "update" | "comment" | "complete" | "reopen" | "archive" | "claim" | "set-status-labels"`
  - `class ForbiddenError extends Error`; `assertAllowed(actor: Actor, action: HubAction): void`
  - `interface HubStore { getItem(id): Promise<Item | null>; listItems(q: ItemQuery): Promise<Item[]>; addItem(i: NewItem): Promise<Item>; updateItem(id, p: ItemPatch): Promise<Item>; complete(id): Promise<Item>; reopen(id): Promise<Item>; archive(id, reason: "merged" | "memo-split", mergedInto: string | null, note: string): Promise<Item>; claim(id): Promise<boolean>; setStatusLabels(id, labels: string[]): Promise<void>; addComment(itemId, body): Promise<Comment>; listComments(itemId): Promise<Comment[]>; getHubState(key): Promise<unknown | null>; setHubState(key, value: unknown): Promise<void> }`
  - `createHubStore(client: SupabaseClient, actor: Actor): HubStore`. Every method calls `assertAllowed` first and writes an `audit_log` row for worker and agent writes.
  - `serviceClient()` and `sessionClient()` in `lib/supabase/server.ts` (`import "server-only"`).

Rules table (the whole policy):

| action | mason | worker | agent |
|---|---|---|---|
| read, add, update, comment | yes | yes | yes |
| complete, reopen | yes | no | no |
| archive | yes | yes | yes |
| claim, set-status-labels | no | yes | no |

`updateItem` from worker or agent may not add or remove `claude` (only Mason approves) nor touch the three status labels (only `claim`/`setStatusLabels` do): throws `ForbiddenError`. `addItem` with an existing `clientKey` returns the existing item instead of inserting.

- [ ] **Step 1: Write failing tests.** `rules.test.ts`: one assertion per cell of the table above. `store.test.ts` (against `fake-store.ts`, an in-memory `HubStore` built on the same rules): agent `complete` throws `ForbiddenError`; worker `updateItem(id, { labels: [...old, "claude"] })` throws; `addItem` twice with `clientKey: "k1"` returns the same `id`; `archive(id, "merged", null, "x")` throws.
- [ ] **Step 2: Run** `npx vitest run tests/unit/hub`. Expected: FAIL.
- [ ] **Step 3: Implement** `types.ts`, `rules.ts`, `store.ts` (Supabase queries; `claim` calls `rpc("hub_claim")`), `lib/supabase/server.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/hub` and an integration test `tests/unit/hub/store.integration.test.ts` (skipped unless `HUB_TEST_DB_URL` points at local Supabase) that repeats the agent-complete and duplicate-clientKey cases against Postgres. Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): core types, rules and supabase store`.

### Task 3: Sign-in and the private gate

**Files:**
- Create: `lib/auth/owner.ts`, `lib/supabase/browser.ts`, `proxy.ts`, `app/hub/login/page.tsx`, `app/hub/auth/callback/route.ts`, `app/hub/layout.tsx`
- Test: `tests/unit/auth/owner.test.ts`, `tests/e2e/hub-auth.spec.ts`

**Interfaces:**
- Consumes: `sessionClient()` (Task 2), `hub_owner` (Task 1).
- Produces: `requireOwner(): Promise<{ userId: string }>` (redirects to `/hub/login` when signed out, renders 404 for a signed-in non-owner); env `HUB_OWNER_GITHUB_ID` (numeric id of GitHub user `masonbair`, from `gh api users/masonbair --jq .id`); `isOwnerIdentity(identity): boolean`, shared with the mobile app in project 3.
- Mobile sign-in: the Supabase redirect allowlist includes the web callback and the collector's deep link `masonbair-collector://auth/callback`. The mobile app signs in with Supabase's GitHub provider (PKCE) and gets the same Supabase user as the web, so `is_owner()` and RLS cover it with no extra code.

- [ ] **Step 1: Write failing tests.** `owner.test.ts`: `isOwnerIdentity({ provider: "github", providerId: "<HUB_OWNER_GITHUB_ID>" })` is true; any other id false; a non-GitHub provider false; missing env var false (fail closed). An integration case on local Supabase: a session for the owner user made through the mobile-style PKCE exchange can read `items`; a session for another GitHub user reads 0 rows. `hub-auth.spec.ts`: signed out, `/hub` redirects to `/hub/login`; `/api/hub/worker/inbox` without a token returns 401; `/hub` and `/hub/login` send `X-Robots-Tag: noindex` and are not in the sitemap.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Supabase GitHub provider (Decision 1). Add both redirect URLs to the allowlist (Decision 5) and write the exact dashboard steps for Mason. On the first callback whose GitHub id matches `HUB_OWNER_GITHUB_ID`, insert the user into `hub_owner` with the service client. `proxy.ts` refreshes the Supabase session cookie and gates `/hub/:path*` (except `/hub/login`, `/hub/auth/callback`, `/hub/manifest.webmanifest`). After Mason's first sign-in, the builder asks Mason to turn off new signups in the Supabase dashboard (Auth settings) and confirms it.
- [ ] **Step 4: Run** the tests, then sign in once on a preview deploy with Mason. Expected: PASS; Mason lands on `/hub`.
- [ ] **Step 5: Commit** `feat(hub): github sign-in and owner gate`.

### Task 4: Private pages

**Files:**
- Create: `app/hub/page.tsx` (inbox), `app/hub/list/[list]/page.tsx`, `app/hub/item/[id]/page.tsx`, `app/hub/actions.ts` (server actions), `components/hub/ItemRow.tsx`, `components/hub/ItemDetail.tsx`, `components/hub/LabelEditor.tsx`
- Test: `tests/e2e/hub-pages.spec.ts` (signed-in owner via a test session helper `tests/e2e/hub-session.ts` that mints a session for a seeded local user)

**Interfaces:**
- Consumes: `requireOwner()`, `createHubStore(sessionClient(), { kind: "mason" })`.
- Produces server actions: `completeItem(id)`, `reopenItem(id)`, `approveItem(id)` (adds `claude`), `updateItemAction(id, patch: ItemPatch)`, `addCommentAction(id, body)`.

Pages: inbox (unsorted items first, then items with `claude-question` or `claude-done` as "needs you"), Todo and Ideas lists, item detail with comments thread (worker results show here, first line bold), labels, due date, Done button, Approve button (rendered only when `HUB_WORKER_LIVE=true`, Decision 6). Archived items are hidden from lists and reachable from the surviving item ("merged from"). Mobile first; same tokens as the public site.

- [ ] **Step 1: Write failing e2e tests** (local Supabase only): seeded inbox shows its items; Done moves an item out of the list and sets `state='done'`; with `HUB_WORKER_LIVE=true` Approve adds `claude`, and without it the button is absent; a worker comment appears on the item page; an archived item is not listed and is linked from its `merged_into` item.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/hub-pages.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages and actions. Load and follow the design-taste-frontend skill for layout and copy.
- [ ] **Step 4: Run** the e2e tests and the axe check from `tests/e2e/a11y.spec.ts` on `/hub`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): inbox, lists and item pages`.

### Task 5: Installable quick capture

**Files:**
- Create: `app/hub/capture/page.tsx`, `components/hub/CaptureForm.tsx`, `lib/hub/outbox.ts`, `app/hub/manifest.webmanifest/route.ts`, `app/hub/share/route.ts`, `app/api/hub/capture/route.ts`, `public/hub/icon-192.png`, `public/hub/icon-512.png`
- Test: `tests/unit/hub/outbox.test.ts`, `tests/e2e/hub-capture.spec.ts`

**Interfaces:**
- Consumes: `addItem` with `clientKey` (Task 2).
- Produces: `POST /api/hub/capture` body `{ title: string; description?: string; clientKey: string }` → `201 { id }` (or `200 { id }` for a repeated `clientKey`); `outbox.enqueue(entry)`, `outbox.flush(send): Promise<number>` (localStorage-backed queue; entries removed only after a 2xx).

Manifest: `name` "Mason's hub", `start_url` `/hub/capture`, `scope` `/hub/`, `display` `standalone`, `share_target` `{ action: "/hub/share", method: "POST", enctype: "multipart/form-data", params: { title: "title", text: "text", url: "url" } }`. Shared text and links become one inbox item (`source` = `share`). Capture screen: one large text field focused on open, Save, a mic button (Decision 4: Web Speech API, hidden when unsupported) with the line "Voice is turned into text by Google." under it, a small "saved" confirmation, and a count of items still waiting to send.

- [ ] **Step 1: Write failing tests.** `outbox.test.ts`: a failed send keeps the entry; a 2xx removes it; flushing twice after one success sends once. `hub-capture.spec.ts`: with the network offline, Save shows "1 waiting"; back online, the item appears in the inbox exactly once; double-clicking Save creates one item; posting the share form creates an inbox item with the shared URL in its description.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `clientKey` = `crypto.randomUUID()` made once per Save. Flush on load, on `online`, and after each Save.
- [ ] **Step 4: Run** the tests (local Supabase); then on Mason's phone (preview deploy) install to home screen and share a link from Chrome into it. Expected: PASS; the item lands in the inbox. That shared item is real data from here on; don't clean it up with a reset.
- [ ] **Step 5: Commit** `feat(hub): installable quick capture with share target`.

### Task 6: Worker API and the ported `hub` CLI

**Files:**
- Create: `app/api/hub/worker/[...op]/route.ts`, `lib/hub/worker-api.ts`, `lib/hub/lifecycle.ts`, `lib/hub/schedule.ts`, `lib/hub/late-migrate.ts`, `lib/hub/notify.ts`, `lib/hub/cli.ts`, `lib/hub/http-store.ts`, `bin/hub`
- Test: `tests/unit/hub/worker-api.test.ts`, `tests/unit/hub/cli.test.ts`, `tests/unit/hub/lifecycle.test.ts`, `tests/unit/hub/schedule.test.ts` (port todo-hub's existing tests for these files and keep them green)

**Interfaces:**
- Consumes: `HubStore`, `hub_claim`.
- Produces:
  - Worker API, bearer `HUB_WORKER_TOKEN`, actor `{ kind: "worker", runId: <X-Hub-Run-Id header> }`. Routes map one to one to `HubStore` methods: `GET inbox|approved|laptop|to-schedule|memos`, `GET item/:id`, `GET item/:id/comments`, `POST item`, `PATCH item/:id`, `POST item/:id/claim`, `POST item/:id/finish`, `POST item/:id/block`, `POST item/:id/merge` (body `{ into: string }`), `POST item/:id/comment`, `GET|PUT state/:key`.
  - `createHttpStore(baseUrl, token, runId): HubStore` so the CLI runs anywhere with only two env vars: `HUB_URL`, `HUB_WORKER_TOKEN` (plus `NTFY_TOPIC`).
  - CLI commands: every todo-hub command keeps its name and exit codes (`setup` becomes a no-op health check), plus new ones that replace the Todoist connector in the worker prompt: `inbox` (JSON of unsorted items), `item <id>`, `comments <id>`, `sort <id> --kind todo|idea|thought [--project <key>] [--laptop] [--due YYYY-MM-DD]`, `merge <newer-id> --into <older-id> --comment-file <path>`, `add --title <t> --description-file <path> [--labels a,b]`.
  - `finish` and `block` post the comment, swap status labels, and send ntfy with line 1 of the comment as the message and the item URL as the click target (as todo-hub does).

- [ ] **Step 1: Port todo-hub's tests** for lifecycle, schedule, late-migrate and cli onto the fake store; add: `merge` archives the newer item with `archived_reason='merged'`, `merged_into=<older>`, and copies the source note onto the older item; `sort` keeps every existing label; two concurrent `claim` calls on the API → one 200, one 409 (CLI exit 3); no API route or CLI command can complete or delete.
- [ ] **Step 2: Run** `npx vitest run tests/unit/hub`. Expected: FAIL.
- [ ] **Step 3: Implement** by porting todo-hub's `src/` logic, replacing Todoist filter strings with `ItemQuery` and the comment-marker claim with `hub_claim`. Granola sweep state moves from a project comment to `hub_state` key `granola-swept-until`.
- [ ] **Step 4: Run** the unit tests, then `HUB_URL=http://localhost:3000 bin/hub approved` against `next dev` with seeded data. Expected: PASS; JSON printed.
- [ ] **Step 5: Commit** `feat(hub): worker api and ported hub cli`.

### Task 7: Memo relay

**Files:**
- Create: `app/api/memo/route.ts`, `lib/hub/memo.ts`, `lib/hub/memo-split.ts`
- Test: `tests/unit/hub/memo.test.ts`, `tests/unit/hub/memo-split.test.ts` (port todo-hub's)

**Interfaces:**
- Consumes: `HubStore` (service client, actor `{ kind: "worker", runId: "memo-relay" }`), `memo_files` table.
- Produces: `POST /api/memo`, bearer `MEMO_UPLOAD_TOKEN`, body exactly as todo-hub's (`{ file, recorded, transcript, device: "phone" | "mac" }`, same validation regexes, 1 MB cap, 15,000-character chunks into comments). Creates one inbox item labeled `hidock-memo`; a `file` already in `memo_files` returns `200 { duplicate: true, id }`. `memo-split` files pieces as `hidock` items, then archives the memo with `archived_reason='memo-split'` (it no longer completes it).

- [ ] **Step 1: Port todo-hub's memo tests;** add: the same `file` posted twice (simulating phone then Mac) gives one item; an empty transcript after trimming is rejected as todo-hub does; `memo-split` leaves the memo `archived`, never `done`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Insert into `memo_files` and `items` in one Postgres function (`hub_accept_memo`) so a crash can't leave a half-accepted memo.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): memo relay on supabase`.

### Task 8: Reminders, approval fire and daily backup

**Files:**
- Create: `supabase/migrations/0003_hub_events.sql`, `app/api/hub/events/[event]/route.ts`, `lib/hub/events.ts`, `lib/hub/backup.ts`, `scripts/hub-restore.ts`
- Test: `tests/unit/hub/events.test.ts`, `tests/unit/hub/backup.test.ts`

**Interfaces:**
- Consumes: `notify()` (Task 6), `items.due_date/due_time`, `hub_state`.
- Produces: `POST /api/hub/events/reminders` and `POST /api/hub/events/approved` (bearer `HUB_EVENTS_TOKEN`). `dueReminders(items: Item[], now: Date, windowMin = 5): Item[]` (open items whose due time falls in the last `windowMin` minutes and not yet reminded, tracked in `hub_state` key `reminded:<id>`). `approved` receives `{ id }`, rechecks that the item has `claude` and no `claude-working`, then calls `ROUTINE_FIRE_URL` with `ROUTINE_FIRE_TOKEN` exactly as todo-hub's relay does.
- Migration: `pg_cron` job every 5 minutes calling `/api/hub/events/reminders` through `pg_net`; an `after update` trigger on `items` that, when `claude` is newly added, calls `/api/hub/events/approved` through `pg_net`. The URL and token come from Supabase Vault secrets (`hub_events_url`, `hub_events_token`), which Mason sets in the dashboard; the builder writes the exact steps for him.
- Backup (Decision 3; the free Supabase plan has no automatic backups): `POST /api/hub/events/backup`, called by a daily `pg_cron` job at 03:00 UTC. `snapshot(store): Promise<{ items: Item[]; comments: Comment[]; hubState: Record<string, unknown>; nowPlace: unknown[]; nowBake: unknown[]; takenAt: string }>` written as JSON to a **private** Vercel Blob at `hub-backups/YYYY-MM-DD.json`; keep the newest 30 and delete older backup files only. `scripts/hub-restore.ts <file> --target <db-url>` restores a snapshot into an empty database (it refuses a non-empty `items` table).

- [ ] **Step 1: Write failing tests:** `dueReminders` returns an item due 3 minutes ago, skips one due 10 minutes ago, skips one already reminded, skips done and archived items; `approved` ignores an item without `claude` and one already `claude-working`; ROUTINE env vars missing → 503, nothing fired. `backup.test.ts`: a snapshot of a seeded store round-trips through `hub-restore` into an empty local database with equal row counts and ids; restore into a non-empty database exits non-zero; pruning keeps exactly the newest 30 files and never deletes a file outside `hub-backups/`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Do not wire the live routine URL in this project (the cutover does); local test uses a stub URL.
- [ ] **Step 4: Run** tests; on local Supabase, add `claude` to a seeded item and see the stub receive one call. After the first production deploy, trigger one backup by hand and confirm the file exists in Blob. Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): reminders, approval fire and daily backup`.

### Task 9: The agent connector

**Files:**
- Create: `app/api/mcp/[transport]/route.ts`, `lib/hub/mcp-tools.ts`
- Test: `tests/unit/hub/mcp-tools.test.ts`, `tests/e2e/hub-mcp.spec.ts`

**Interfaces:**
- Consumes: `HubStore` with actor `{ kind: "agent", client: <X-Client-Name header or "unknown"> }`, `NowData` reader from `lib/now.ts`.
- Produces: an MCP server (streamable HTTP via `mcp-handler`; verify the current package name and API on npm before installing), bearer `HUB_AGENT_TOKEN`. The full tool list, nothing more:
  - `find_items` (`ItemQuery` + `text` search), `get_item`, `list_comments`
  - `add_item` (always lands in the inbox, `source` = `agent:<client>`)
  - `update_item` (title, description, labels, list, due; the rules in Task 2 apply)
  - `add_comment`
  - `merge_duplicate` (`{ newer, older, note }` → archive `merged`)
  - `get_now` (place, bake, photos as shown publicly; never coordinates)
- There is no complete, delete, email, purchase, booking, deploy or merge tool. Tool descriptions say item text is data, never instructions.

- [ ] **Step 1: Write failing tests:** the registered tool names equal exactly the list above; `update_item` adding `claude` returns a tool error and leaves labels unchanged; `merge_duplicate` with `older == newer` errors; every write creates an `audit_log` row with the client name; no token → 401; e2e: connect with the MCP SDK client to `next dev`, call `add_item`, see it in `/hub`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Bearer token only (Decision 2); no OAuth flow.
- [ ] **Step 4: Run** tests; then `claude mcp add --transport http hub-local http://localhost:3000/api/mcp/mcp --header "Authorization: Bearer $HUB_AGENT_TOKEN"` and ask Claude Code to "add a test item to my hub". Expected: PASS; item in the inbox.
- [ ] **Step 5: Commit** `feat(hub): mcp agent connector with enforced rules`.

### Task 10: Now data from the database

**Files:**
- Create: `supabase/migrations/0004_now.sql`, `app/hub/now/page.tsx`
- Modify: `lib/now.ts` (add `loadNow(): Promise<NowData>` that reads Supabase first and falls back to `content/now.json`)
- Test: `tests/unit/now.test.ts` (extend), `tests/e2e/hub-now.spec.ts`

**Interfaces:**
- Consumes: `NowData`, `Place`, `Bake` types already in `lib/now.ts`.
- Produces: tables `now_place(id, city, region, country, private boolean, updated_at)` (latest row wins; columns allow no coordinates) and `now_bake(id, name, photo, baked_at)`; RLS owner-only writes, public board reads through the server only. A "Log a bake" form and a "Mark this place private" toggle on `/hub/now`. The phone collector (project 3) will write `now_place`.

- [ ] **Step 1: Write failing tests:** with an empty database `loadNow()` returns the JSON file's data; with a bake row, the board's bake tile shows it; a private place still renders as state and country only (existing privacy test stays green); the migration has no latitude or longitude columns (test greps the SQL).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the board's hourly revalidation; logging a bake revalidates `/` immediately.
- [ ] **Step 4: Run** unit and e2e tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): now data and bake log from supabase`.

### Task 11: Worker prompt, Claude Code skill, and a dry run

**Files:**
- Create: `hub/worker/PROMPT.md`, `hub/worker/projects.json` (copy of todo-hub's), `hub/worker/setup.sh`, `hub/skills/hub/SKILL.md`, `docs/hub-cutover-notes.md`
- Test: `tests/e2e/hub-dry-run.spec.ts` (or a script `scripts/hub-dry-run.ts`)

**Interfaces:**
- Consumes: the `bin/hub` CLI (Task 6) and the connector tools (Task 9).
- Produces: a worker prompt that keeps todo-hub's sections 1 to 9 and their safety rules word for word where they still apply, replacing every Todoist connector step with the `hub` CLI command that now does it (`inbox`, `sort`, `merge`, `comments`), and "complete the newer task" with `hub merge`. A skill with todo-hub's behavior ("add that to my list", laptop tasks) using the `hub` connector tools. `docs/hub-cutover-notes.md`: the env vars, Vault secrets and routine changes project 5 must make. None of these are installed or activated.

- [ ] **Step 1: Write the dry run** (local Supabase only, never the live project): seed 6 inbox items (a clear to-do, an idea, an unclear note, a duplicate pair, one `hidock-memo` with a transcript, one approved item); run the CLI steps the prompt calls for with canned decisions; assert: unclear note still in inbox untouched; duplicate pair → one open, one archived `merged` pointing at it; memo → pieces filed, memo archived `memo-split`; approved item → `claude-done` with a comment and one ntfy call to a stub; nothing deleted (row count only grows); no item is `done`.
- [ ] **Step 2: Run.** Expected: FAIL until prompt-driven commands exist.
- [ ] **Step 3: Write** the prompt, skill and notes. Diff the new prompt's safety section against todo-hub's and keep every rule.
- [ ] **Step 4: Run** the dry run, the full unit and e2e suites, `npm run build`, and a Vercel preview deploy (preview only). Expected: all green; `/hub` works signed in on the preview.
- [ ] **Step 5: Commit** `feat(hub): worker prompt, skill and dry run`.

---

## Build order

1. Database first (Task 1), then the rules and store everything shares (Task 2).
2. Mason's way in: sign-in, pages, phone capture (Tasks 3 to 5).
3. Machines' way in: worker API and CLI, memo relay, triggers, agent connector (Tasks 6 to 9).
4. Board reads live data (Task 10), then the worker prompt, skill and an end-to-end dry run (Task 11). The private side goes live with Mason's production deploy; the existing todo-hub paths switch in project 5.

## Env vars this project adds (Mason sets them in Vercel; values in `.env.local` locally)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `HUB_OWNER_GITHUB_ID`, `HUB_WORKER_TOKEN`, `HUB_AGENT_TOKEN`, `HUB_EVENTS_TOKEN`, `MEMO_UPLOAD_TOKEN`, `NTFY_TOPIC`, `BLOB_READ_WRITE_TOKEN` (private store for backups), `HUB_WORKER_LIVE` (`false` until project 5), and (at cutover) `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` already exist from the leaderboard.
