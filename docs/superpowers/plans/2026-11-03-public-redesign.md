# Public Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static résumé page at masonbair.com with a "Right Now" board that shows who Mason is, where he is, and what he is building, kept current without code edits, plus the polished cat game with a shared leaderboard.

**Architecture:** Next.js (App Router) on Vercel, in place of the static `index.html`/`style.css`/`script.js`. The board is a Server Component that calls one data function, `getBoard()`, which merges live GitHub data (fetched on the server, cached for an hour) with a "now" source. Until project 2 exists, the now source reads `content/now.json`; project 2 swaps that one reader for Supabase without touching the UI. The cat game is a client island. The shared leaderboard is the only part that needs Supabase in this project.

**Tech Stack:** Next.js (latest stable, App Router, TypeScript), Tailwind CSS v4 (`@tailwindcss/postcss`), Motion (`motion/react`), `@phosphor-icons/react`, `next/font/google` (Plus Jakarta Sans + Geist Mono), Vitest, Playwright, `@supabase/supabase-js`, `obscenity` (name filter). Node 24.

**Spec:** `docs/superpowers/specs/2026-11-03-masonbair-personal-hub-design.md` (section 1). Read it before starting.

## Global Constraints

- Palette, verbatim: tropical indigo `#8783d1` (the one accent), rose quartz `#aa9aba`, tea rose `#d1abad`, background `#f7f6fd`. No other accent hue anywhere.
- Fonts: not Montserrat, not Inter. Use Plus Jakarta Sans (display + body), Geist Mono for numbers only.
- Light and dark mode via `prefers-color-scheme`, both tested. No pure `#000` / `#fff`.
- One radius system: tiles `1.5rem`, inner images `calc(1.5rem - 0.375rem)`, buttons and pills full-round.
- Zero em dashes (`—`) or en dashes (`–`) in any visible text, alt text, or metadata.
- Only city, region (state), and country are ever stored or rendered for location. No coordinates anywhere in types, JSON, or HTML.
- Every animation respects `prefers-reduced-motion` (static fallback). Animate only `transform` and `opacity`.
- Full-height sections use `min-h-[100dvh]`, never `h-screen`.
- Icons: Phosphor only, one weight (`light`) site-wide. No hand-drawn SVG icons.
- Keep: the `/coffee` redirect in `vercel.json`; every file in `misc/` reachable at its current URL `/misc/<name>`; anchors `#about`, `#projects`, `#achievements`, `#resume`; links to `https://github.com/masonbair` and `https://www.linkedin.com/in/masonbair/`.
- Free services only. Do not create a paid Supabase project; ask Mason first (Task 8).
- Do not touch `.github/workflows/aws.yml`, `.aws/`, `Dockerfile`, `nginx.conf`, `README.md` (spec: ask Mason before removing the old AWS pipeline).
- Never deploy to production. Preview deploys only; Mason promotes.
- Work on branch `redesign` in a worktree (superpowers:using-git-worktrees).
- Copy rules: plain, concrete words; no "elevate", "seamless", "unleash"; no section-number eyebrows; at most one small uppercase eyebrow per three sections.

## Review Focus

1. **GitHub is down, rate-limited, or the token is missing.** The page still renders; the GitHub tile shows a plain "See my GitHub" link instead of numbers. Test in Task 4 (`returns null on non-200`, `returns null with no token`) and Task 5 (`board renders when github is null`).
2. **The now source holds extra fields or a private place.** A `lat`/`lng` key in `now.json` is dropped by the parser and never reaches HTML; a place with `private: true` renders only region or country. Test in Task 3 (`parseNow strips unknown keys`, `formatLocation hides city when private`) and Task 5 (`html never contains lat`).
3. **A photo path in `now.json` points at a missing file, or the list is empty.** The photo tile falls back to `/misc/Mason_web.webp`; no broken image. Test in Task 3 (`parseNow drops photos with non-/misc paths`) and Task 5 (`empty photos shows fallback`).
4. **Leaderboard abuse:** HTML in the name, offensive name, a 10,000,000 score, 50 posts a minute from one visitor. Expected: name stored as plain text and escaped on render, offensive names rejected with 400, scores over `MAX_SCORE` rejected, the sixth post in 10 minutes from one IP gets 429. Test in Task 8.
5. **Phone width (375 px).** No horizontal page scroll, every tile one column, game circles stay inside the viewport and are at least 44 px. Test in Task 5 and Task 7 (Playwright mobile project).

---

## File Structure

```
app/
  layout.tsx            fonts, metadata, theme tokens, <Nav/>
  page.tsx              <Board/> then the about/work/achievements/resume sections, <CatGame/>
  globals.css           Tailwind v4 import, @theme tokens, dark-mode overrides
  api/leaderboard/route.ts   GET top 10, POST a score (Task 8)
components/
  Nav.tsx               floating pill nav, mobile menu (client leaf for the menu only)
  board/Board.tsx       server: lays out tiles from a Board object
  board/tiles/*.tsx     HelloTile, LocationTile, GithubTile, ProjectsTile, BakeTile, PhotoTile
  board/Reveal.tsx      client leaf: Motion whileInView wrapper
  sections/About.tsx, Work.tsx, Achievements.tsx, Resume.tsx
  game/CatGame.tsx      client: circles, score, cat stages
  game/Leaderboard.tsx  client: list + submit form
lib/
  board.ts              getBoard(): Promise<Board>
  now.ts                NowData type, parseNow(), readNow()
  location.ts           formatLocation()
  time.ts               timeAgo()
  github.ts             getGithubActivity()
  cat.ts                catStage()
  leaderboard.ts        validateEntry(), MAX_SCORE, rate-limit helper
content/
  now.json              stub data until project 2
  site.ts               about/experience/achievements copy, ported from index.html
public/misc/            moved from misc/ (git mv), URLs unchanged
supabase/migrations/0001_leaderboard.sql
tests/unit/*.test.ts    Vitest
tests/e2e/*.spec.ts     Playwright (desktop 1280 + mobile 375 projects)
```

---

### Task 1: Next.js scaffold in place, assets moved, old page still in git

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `app/layout.tsx` (minimal), `app/page.tsx` (minimal), `app/globals.css`
- Move: `misc/` to `public/misc/` (`git mv`)
- Modify: `.gitignore` (add `node_modules`, `.next`, `test-results`, `playwright-report`)
- Delete: `index.html`, `style.css`, `script.js` only after Tasks 5 to 7 port them (Task 9)
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm test` (Vitest), `npm run e2e` (Playwright, starts `next dev` via `webServer`). Playwright projects named `desktop` (1280x800) and `mobile` (375x812).

- [ ] **Step 1:** Scaffold with `npx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*"` in the worktree (it will warn about existing files; keep them). Confirm Tailwind is v4 and `postcss.config.mjs` uses `@tailwindcss/postcss`.
- [ ] **Step 2:** Install: `npm i motion @phosphor-icons/react @supabase/supabase-js obscenity` and `npm i -D vitest @playwright/test` then `npx playwright install chromium`.
- [ ] **Step 3:** `git mv misc public/misc`. Keep `vercel.json` untouched.
- [ ] **Step 4: Write the failing test** `tests/e2e/smoke.spec.ts`:
  - `resume pdf is served at its old url`: `GET /misc/Mason_Bair_Resume_01_20_2026.pdf` returns 200 and `content-type` contains `pdf`.
  - `home renders`: `/` returns 200 and has a `<main>`.
- [ ] **Step 5:** Run `npm run e2e -- smoke`. Expected: `home renders` fails until `app/page.tsx` has `<main>`; add it; both pass.
- [ ] **Step 6:** Run `npm run build`. Expected: build succeeds.
- [ ] **Step 7: Commit** `chore: scaffold next.js app and move misc to public`

---

### Task 2: Design tokens, fonts, nav, dark mode

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`
- Create: `components/Nav.tsx`
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Produces CSS tokens (Tailwind v4 `@theme`), used by every later task as utilities: `bg-canvas`, `bg-surface`, `text-ink`, `text-mute`, `bg-accent`, `text-accent`, `bg-rose`, `bg-tea`, `shadow-tile`, `rounded-tile`.
  - Light: canvas `#f7f6fd`, surface `#fdfcff`, ink `#1f1d33`, mute `#5d5a78`, accent `#8783d1`, rose `#aa9aba`, tea `#d1abad`, tile shadow `0 12px 40px -12px rgb(135 131 209 / 0.28)`.
  - Dark (builder picks exact values): canvas and surface are deep indigo-tinted near-blacks (not `#000`), ink an off-white, accent stays `#8783d1` or a lighter tint of it with AA contrast on surface.
- Produces `<Nav/>`: floating pill, detached from the top, max 72 px tall, one line at 1024 px. Labels exactly: `About`, `Work`, `Résumé`, `GitHub`, `LinkedIn` (anchors `#about`, `#projects`, `#resume`). Below 768 px a menu button that morphs into an X and opens a full-screen overlay with staggered links (Motion, reduced-motion = instant).
- Metadata in `layout.tsx`: title `Mason Bair`, description one sentence in Mason's voice, Open Graph image `/misc/Mason_web.webp`.

- [ ] **Step 1: Write the failing tests** in `tests/e2e/shell.spec.ts`:
  - `nav is one line at 1024`: at 1024x800, the nav's bounding box height is at most 72.
  - `dark mode uses dark canvas`: with `colorScheme: 'dark'`, computed `body` background is not `rgb(247, 246, 253)`.
  - `mobile menu opens and closes` (mobile project): click menu button, link `Résumé` visible; press Escape, hidden.
  - `no em dashes`: page text contains neither `—` nor `–`.
- [ ] **Step 2:** Run `npm run e2e -- shell`. Expected: FAIL.
- [ ] **Step 3:** Implement tokens, fonts via `next/font/google` (`Plus_Jakarta_Sans`, `Geist_Mono`), and `Nav`. Add a fixed, `pointer-events-none` grain overlay at `opacity: 0.03` (body pseudo-element, never on scrolling containers).
- [ ] **Step 4:** Run `npm run e2e -- shell`. Expected: PASS on both projects.
- [ ] **Step 5: Commit** `feat: design tokens, fonts, floating nav, dark mode`

---

### Task 3: Now data, location formatting, time-ago

**Files:**
- Create: `lib/now.ts`, `lib/location.ts`, `lib/time.ts`, `content/now.json`
- Test: `tests/unit/now.test.ts`, `tests/unit/location.test.ts`, `tests/unit/time.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Place = { city: string; region: string; country: string; private: boolean; updatedAt: string /* ISO */ };
  type Bake = { name: string; photo: string | null; bakedAt: string };
  type Photo = { src: string; alt: string };
  type NowData = { place: Place | null; countriesVisited: number; bake: Bake | null; photos: Photo[] };
  function parseNow(raw: unknown): NowData;          // never throws; bad parts become null / [] / 0
  async function readNow(): Promise<NowData>;        // reads content/now.json; project 2 replaces only this
  function formatLocation(p: Place): string;         // "Lisbon, Portugal" or, when private, "Ohio, United States" -> "Ohio"
  function timeAgo(iso: string, now?: Date): string; // "just now", "3 hours ago", "2 days ago", "5 weeks ago"
  ```
- `content/now.json` seed: `countriesVisited: 21`; `place` Mason's current city if he gives one, else `null`; `bake: null`; `photos` = 4 to 6 existing `/misc/*.webp` life and travel shots with real alt text (for example `Mason_traveling.webp`, `Mason_networking_at_hackathon_horizontal.webp`, `MLH_hackcon_solo.webp`, `Mason_infront_of_hacksu_sign.webp`).

- [ ] **Step 1: Write the failing tests:**
  - `parseNow strips unknown keys`: input place with `lat: 1, lng: 2` yields an object where `'lat' in result.place` is false and `JSON.stringify(result)` has no `lat`.
  - `parseNow drops photos with non-/misc paths`: `{src: 'https://evil/x.jpg'}` and `{src: '/misc/../.env'}` are dropped; `/misc/a.webp` kept.
  - `parseNow tolerates garbage`: `parseNow(null)` equals `{place: null, countriesVisited: 0, bake: null, photos: []}`.
  - `formatLocation shows city and country`: `{city:'Lisbon', region:'Lisbon', country:'Portugal', private:false}` gives `'Lisbon, Portugal'`.
  - `formatLocation hides city when private`: `{city:'Kent', region:'Ohio', country:'United States', private:true}` gives `'Ohio, United States'`; result does not contain `Kent`.
  - `timeAgo` cases: 30 s gives `just now`; 3 h gives `3 hours ago`; 1 day gives `1 day ago`; 36 days gives `5 weeks ago`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. `parseNow` builds new objects field by field (whitelist), so unknown keys can never pass through. Photo `src` must match `^/misc/[A-Za-z0-9._-]+\.(webp|jpe?g|png)$`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: now data parser, location and time formatting`

---

### Task 4: GitHub activity

**Files:**
- Create: `lib/github.ts`, `tests/unit/fixtures/github-graphql.json`
- Test: `tests/unit/github.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Repo = { name: string; url: string; homepage: string | null; description: string | null; pushedAt: string };
  type GithubActivity = { commits30d: number; repos30d: number; recent: Repo[]; online: Repo[] };
  async function getGithubActivity(user = 'masonbair', fetchImpl = fetch, token = process.env.GITHUB_TOKEN): Promise<GithubActivity | null>;
  ```
- One GraphQL call to `https://api.github.com/graphql` with `contributionsCollection(from: now-30d, to: now) { totalCommitContributions commitContributionsByRepository { repository { name } } }` and `repositories(first: 20, privacy: PUBLIC, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) { nodes { name url homepageUrl description pushedAt isFork } }`.
- `recent` = first 3 non-fork repos. `online` = non-fork repos whose `homepageUrl` is a non-empty `https://` URL. This is how "side projects that are online" stay current with no code edits: Mason sets a repo's Website field on GitHub (decision recorded in the plan; Mason's open question in the spec is answered by which repos he gives a website).
- Cache: call `fetchImpl` with `{ next: { revalidate: 3600 } }`.
- Needs env var `GITHUB_TOKEN`: a fine-grained token with no repository access and no extra permissions (public data only). Mason creates it; add to Vercel preview + production env. Builder asks Mason for it when reaching this task; the code must work without it (returns null).

- [ ] **Step 1: Write the failing tests** (pass a fake `fetchImpl`):
  - `summarizes fixture`: with the fixture (5 contributions over 2 repos, 4 repos of which 1 fork and 1 with homepage `https://example.dev`), result is `{commits30d: 5, repos30d: 2}`, `recent.length === 3`, no fork in `recent`, `online.map(r=>r.name)` equals the one homepage repo.
  - `ignores non-https homepage`: homepage `javascript:alert(1)` is not in `online`.
  - `returns null on non-200`: fake returns status 502; result `null`; no throw.
  - `returns null with no token`: `token` undefined; `fetchImpl` never called; result `null`.
- [ ] **Step 2:** `npm test -- github`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test -- github`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: github activity from graphql with hourly cache`

---

### Task 5: The Right Now board

**Files:**
- Create: `lib/board.ts`, `components/board/Board.tsx`, `components/board/Reveal.tsx`, `components/board/tiles/{HelloTile,LocationTile,GithubTile,ProjectsTile,BakeTile,PhotoTile}.tsx`
- Modify: `app/page.tsx`, `lib/now.ts` (`readNow` honors `NOW_FIXTURE`), `playwright.config.ts`
- Create: `tests/e2e/fixtures/{full,empty,private,coords}.json`
- Test: `tests/e2e/board.spec.ts`, `tests/unit/board.test.ts`

**Interfaces:**
- Consumes: `readNow`, `formatLocation`, `timeAgo` (Task 3), `getGithubActivity` (Task 4).
- Produces:
  ```ts
  type Board = { now: NowData; github: GithubActivity | null };
  async function getBoard(deps?: { readNow?: () => Promise<NowData>; github?: () => Promise<GithubActivity | null> }): Promise<Board>;
  ```
  `app/page.tsx` is a Server Component with `export const revalidate = 3600`.
- Test-only data override: when `process.env.NOW_FIXTURE` names a file in `tests/e2e/fixtures/`, `readNow` reads it instead (used only by Playwright `webServer.env`; ignored in production builds).

**Design (from the spec and the taste rules; the builder owns pixels):**
- Desktop grid: 12 columns, max width 1400 px. Hello tile spans 6 columns x 2 rows (photo `Mason_web.webp`, bottom scrim, "Hi, I'm Mason." plus one line, max 20 words, Mason's voice). The other tiles fill the rest with mixed sizes; tiles with no data are not rendered and the grid uses `grid-auto-flow: dense` so there are never empty cells.
- Tile backgrounds vary: Location on solid accent with off-white text; Bake on tea; Photo is a full-bleed image; GitHub and Projects on surface. Numbers in Geist Mono.
- Each tile uses the double-bezel shell: outer `p-1.5` ring at 5% ink, inner core with its own radius and a 1 px inner highlight.
- Location tile: label `Currently in`, `formatLocation(place)`, then `Country {countriesVisited}` and `updated {timeAgo}`. No place: show `{countriesVisited} countries and counting`.
- GitHub tile: `{commits30d} commits` and `across {repos30d} repos, last 30 days`, plus the 3 `recent` repo names as links. Null: one line `See what I'm building` linking to GitHub.
- Projects tile: `online` repos as link rows (name, description). Hidden when empty.
- Bake tile: name, `timeAgo(bakedAt)`, photo if any. Hidden when `bake` is null.
- Photo tile: crossfades through `photos` every 6 s (pause on hover and when tab hidden; static first photo under reduced motion). Empty list: `/misc/Mason_web.webp` is not reused if the hello tile has it; use `/misc/Mason_traveling.webp`.
- Entry: tiles fade up from `translateY(24px)` with 60 ms stagger, `cubic-bezier(0.16, 1, 0.3, 1)`, 700 ms, via `Reveal` (Motion `whileInView`, `once: true`).
- Below 768 px: single column, Hello tile first, full width, `px-4`.
- Hero rule: the board top sits within `pt-24` of the nav; the hello text and nav are visible without scrolling at 1280x800 and 375x812.

- [ ] **Step 1: Write the failing tests.** Unit (`board.test.ts`): `getBoard merges sources` with fake deps returns both parts; `getBoard survives github throwing` returns `github: null`. E2E (`board.spec.ts`) using fixtures `full.json` and `empty.json` (two Playwright `webServer` entries or a per-test env switch; builder's choice):
  - `full board shows location`: text `Lisbon, Portugal` visible.
  - `private place hides city`: fixture with `private: true` and city `Kent` shows `Ohio`, and page HTML does not contain `Kent`.
  - `html never contains lat`: fixture with `lat`/`lng` keys; page HTML contains neither `"lat"` nor `lat:`.
  - `board renders when github is null` (no `GITHUB_TOKEN` in test env): link `See what I'm building` visible.
  - `empty photos shows fallback`: with `empty.json`, an `img` with `src` containing `Mason_traveling` is visible and has `naturalWidth > 0`.
  - `no empty grid cells`: with `empty.json`, every direct child of the grid has non-zero text or an image.
  - `mobile has no horizontal scroll` (mobile): `document.documentElement.scrollWidth <= 375`.
  - `hello visible without scroll` (both): the "Hi, I'm Mason." heading bounding box bottom is within the viewport.
- [ ] **Step 2:** `npm test && npm run e2e -- board`. Expected: FAIL.
- [ ] **Step 3:** Implement `getBoard` (wrap each source in try/catch to null) and the tiles.
- [ ] **Step 4:** `npm test && npm run e2e -- board`. Expected: PASS on desktop and mobile.
- [ ] **Step 5:** Use the browser-testing skill to screenshot `/` at 1280 and 375 in light and dark. Check against the Global Constraints and the taste pre-flight (no three equal cards, one accent, no em dashes, eyebrow count). Fix what fails.
- [ ] **Step 6: Commit** `feat: right now board with live github and now tiles`

---

### Task 6: About, work, achievements, résumé sections

**Files:**
- Create: `content/site.ts`, `components/sections/{About,Work,Achievements,Resume}.tsx`
- Modify: `app/page.tsx`
- Test: `tests/e2e/sections.spec.ts`

**Interfaces:**
- Produces in `content/site.ts`: `about: string[]` (paragraphs), `work: Array<{title, org, dates, summary, tech: string[], image}>`, `achievements: Array<{title, summary, image?}>`, `gallery: Array<{src, alt}>`, `resumeHref = '/misc/Mason_Bair_Resume_01_20_2026.pdf'`.
- Port every fact from the current `index.html` sections (about, projects/experience, achievements, gallery, résumé/education). Trim wording; do not invent facts or numbers. Update tense where the spec makes it clear (he is now a digital nomad; graduation was May 2026). Flag any fact that looks out of date in the task report instead of guessing.
- Section ids exactly: `about`, `projects`, `achievements`, `resume`.
- Each section uses a different layout family (for example: About as text beside a portrait; Work as a vertical timeline with small images; Achievements as an asymmetric bento with 2 to 3 image cells; Résumé as a single wide panel with one primary button `Download résumé`). No two consecutive image+text splits. The gallery becomes a horizontal scroll-snap strip inside Achievements (the page's only marquee-like element).

- [ ] **Step 1: Write the failing tests:**
  - `anchors exist`: elements `#about`, `#projects`, `#achievements`, `#resume` exist.
  - `resume download works`: the `Download résumé` link `href` returns 200.
  - `facts carried over`: page text contains `Kent State`, `Nationwide`, `HacKSU`, `Eagle Scout`, `Tartu`.
  - `nav anchors scroll`: clicking nav `Work` puts `#projects` top within 100 px of the viewport top.
- [ ] **Step 2:** `npm run e2e -- sections`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run e2e -- sections`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: about, work, achievements, resume sections`

---

### Task 7: Cat game, ported and polished

**Files:**
- Create: `lib/cat.ts`, `components/game/CatGame.tsx`, `components/game/Leaderboard.tsx`
- Modify: `app/page.tsx`, `components/Nav.tsx` (score pill)
- Test: `tests/unit/cat.test.ts`, `tests/e2e/game.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  function catStage(score: number): number; // Math.min(10, Math.floor(score / 2)), 0 for negatives
  const CAT_STAGE_LINES: readonly string[];  // 11 lines, index = stage, ported from script.js titles
  ```
- `<CatGame/>` (client): same rules as today: one circle at a time at a random spot inside the viewport, click grows the score by 1 and spawns the next; the cat gains one feature every 2 points through 10 stages (ears, eyes, nose, whiskers, tail, spots, crown, wings, sparkles, rainbow aura); random cat color on load; random player name on load. Score shows in a pill in the nav; clicking it opens the leaderboard.
- Placement (builder's design call within the spec): the cat stays fixed in the bottom-right corner as today, restyled in the new palette. It must not cover the hello tile at 375 px (shrink or tuck it).
- Polish: circles use the accent color and a soft scale-in; a short confetti or ring burst on each stage-up (reduced motion: none); stage line shown in a small toast on stage-up instead of a hover `title`. Emoji allowed only inside these playful stage lines.
- `<Leaderboard/>` in this task keeps today's `localStorage` key `catGameLeaderboard` and shape so existing local scores survive. Task 8 swaps its data calls.
- Circles: minimum 44 px, kept fully inside the viewport, never under the nav.

- [ ] **Step 1: Write the failing tests:**
  - Unit: `catStage(0) === 0`, `catStage(3) === 1`, `catStage(20) === 10`, `catStage(999) === 10`, `catStage(-4) === 0`; `CAT_STAGE_LINES.length === 11`.
  - E2E `clicking circles raises score`: click the circle 4 times; nav score pill reads `4`; the cat has the stage-2 marker (eyes) (`data-stage="2"` on the cat root).
  - E2E `circle stays in viewport` (mobile): over 10 spawns, every circle box is inside 0..375 x 0..812 and at least 44 px wide.
  - E2E `local leaderboard saves`: score 2, open leaderboard, save as `Tester`; the list shows `Tester`.
- [ ] **Step 2:** `npm test && npm run e2e -- game`. Expected: FAIL.
- [ ] **Step 3:** Implement. Put the cat's CSS in a CSS module next to the component (port the stage styles from `style.css`).
- [ ] **Step 4:** `npm test && npm run e2e -- game`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: port and polish cat game`

---

### Task 8: Shared leaderboard on Supabase

**Gate (do first):** check Mason's Supabase account for a free project slot (`supabase projects list`, or ask Mason). Free plan allows 2 active projects and where_are_my_friends uses one. If no free slot, **stop and ask Mason**; do not pay, and do not use the where_are_my_friends project. Name the new project `masonbair` (project 2 reuses it).

**Files:**
- Create: `supabase/migrations/0001_leaderboard.sql`, `lib/leaderboard.ts`, `app/api/leaderboard/route.ts`
- Modify: `components/game/Leaderboard.tsx`
- Test: `tests/unit/leaderboard.test.ts`, `tests/unit/leaderboard-route.test.ts`

**Interfaces:**
- Table `leaderboard(id bigint identity pk, name text not null check (char_length(name) between 1 and 20), score int not null check (score between 1 and 1000), ip_hash text not null, created_at timestamptz default now())`, index on `(score desc)` and `(ip_hash, created_at)`. Row level security on, no public policies: only the server route (service role key) reads and writes.
- Env vars (Vercel + `.env.local`, never committed): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LEADERBOARD_SALT`.
- Produces:
  ```ts
  const MAX_SCORE = 1000;
  type Entry = { name: string; score: number };
  function validateEntry(raw: unknown): { ok: true; entry: Entry } | { ok: false; error: 'bad_name' | 'offensive_name' | 'bad_score' };
  function hashIp(ip: string, salt: string): string;           // sha256 hex
  const RATE_LIMIT = { max: 5, windowMinutes: 10 };
  ```
  `GET /api/leaderboard` returns `{ entries: Entry[] }` (top 10 by score, then earliest). `POST` with JSON `Entry` returns 201, 400 `{error}`, or 429 `{error: 'rate_limited'}`.
- Name rules: trim; collapse inner whitespace; 1 to 20 characters; reject with `offensive_name` when `obscenity`'s English matcher (`englishDataset` + `englishRecommendedTransformers`) matches. Names are stored as plain text; the client renders them as text nodes only (never `innerHTML`).
- Rate limit: count rows with the same `ip_hash` in the last 10 minutes; at 5 or more, 429. IP from the `x-forwarded-for` first entry (Vercel sets it).
- Client: `Leaderboard` fetches `GET` on open and `POST`s on save; on any network error it falls back to the Task 7 local list and shows `Couldn't reach the leaderboard. Saved on this device.`

- [ ] **Step 1: Write the failing tests:**
  - `validateEntry` rejects: `{name:'', score:5}` gives `bad_name`; 21-char name gives `bad_name`; `{name:'ok', score:0}`, `1001`, `2.5`, `'5'` give `bad_score`; a known profane word gives `offensive_name`.
  - `validateEntry` accepts `{name:'  Mason   B ', score: 12}` as `{name:'Mason B', score:12}` and keeps `<b>hi</b>` as literal text (it is a valid name; escaping happens at render).
  - Route test with a fake Supabase client: sixth POST from one IP within 10 minutes gives 429; a POST with score `10000000` gives 400 and inserts nothing; GET returns at most 10 entries sorted by score desc.
- [ ] **Step 2:** `npm test -- leaderboard`. Expected: FAIL.
- [ ] **Step 3:** Implement. Apply the migration with `supabase db push` (or the dashboard SQL editor) to the `masonbair` project.
- [ ] **Step 4:** `npm test -- leaderboard`. Expected: PASS. Then against a preview deploy: save a score from two browsers and see both in each list.
- [ ] **Step 5: Commit** `feat: shared cat game leaderboard on supabase`

---

### Task 9: Cutover, checks, preview deploy

**Files:**
- Delete: `index.html`, `style.css`, `script.js`
- Test: `tests/e2e/a11y.spec.ts`

- [ ] **Step 1: Write the failing test** `a11y.spec.ts` with `@axe-core/playwright` (`npm i -D @axe-core/playwright`): no `serious` or `critical` violations on `/` in light and dark, desktop and mobile.
- [ ] **Step 2:** Run it; fix violations until it passes.
- [ ] **Step 3:** Delete the three old static files. Run `npm run build && npm test && npm run e2e`. Expected: all pass.
- [ ] **Step 4:** Check `/coffee` still redirects on `next start` (curl `-I`, expect 307 to the Google Calendar booking URL).
- [ ] **Step 5:** Deploy a **preview** (`vercel deploy`, not `--prod`). Run Lighthouse on the preview URL (mobile): LCP under 2.5 s, CLS under 0.1, accessibility 95+. Record the numbers in the task report.
- [ ] **Step 6:** Browser-testing skill: screenshots of the preview at 1280 and 375, light and dark, plus one played game round. Attach to the report.
- [ ] **Step 7: Commit** `chore: remove old static site`. Report the preview URL to Mason. Production deploy and merging to `main` are Mason's call.
