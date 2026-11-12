# Board in Motion — Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home board feel alive: tiles swing in on scroll, lean toward the cursor and lift when pressed, the dot background bends away from the cursor, visitors can doodle, and colors follow the time of day where Mason is.

**Architecture:** Scroll swing is pure CSS (scroll-driven animation, falls back to today's fade-up). Everything else lives in one client island, `components/board/motion/`, loaded after `load` + idle exactly like `components/game/LazyGame.tsx`, so none of it is in the first-load JavaScript. The math (lean angle, dot push, sun phase) sits in pure functions under `lib/motion/` with unit tests; behavior is checked with Playwright.

**Tech Stack:** Next.js 16.4 (read `node_modules/next/dist/docs/` first), React 19, Tailwind v4, Vitest (node env, `tests/unit/**/*.test.ts`), Playwright (`tests/e2e`, fixtures via `fixtureUrl`). No new dependencies; plain `requestAnimationFrame` and canvas, not Motion.

**Spec:** `docs/superpowers/specs/2026-11-12-board-in-motion-design.md`

## Global Constraints

- First-screen tiles (`FIRST_SCREEN` in `components/board/Board.tsx`: hello, location, photo, github) paint at once; nothing animates them in or delays them.
- `viv check` stays green: Lighthouse search / agent / accessibility 100, speed ≥95, LCP ≤2.5s on `/` and `/coffee`, tiles ≤8.
- Every effect is off under `prefers-reduced-motion: reduce` (`lib/use-reduced-motion.ts` in React, the media query in CSS).
- Touch / coarse pointer: no lean, no dot bending; press-lift still works. No motion-sensor permission prompts.
- Colors and shadows only from tokens in `app/globals.css`; new color steps are added there as tokens, light and dark.
- Nothing loops forever in peripheral vision; nothing moves text while it is being read.
- Mason's time zone reaches the page only as a UTC offset in minutes, never a zone name or place.
- Work on a branch in a worktree (`superpowers:using-git-worktrees`), branch `board-motion-batch-1`. Agents commit on the branch; Mason merges and pushes.

## Review Focus

1. **Tile links during and after doodle mode** — clicking a tile link must work whenever draw mode is off, and Escape must always leave draw mode. Test in Task 4.
2. **Window resize / orientation change** — dot canvas and doodle canvas resize to the viewport without stretching or blurring (use `devicePixelRatio`). Test in Task 3.
3. **Tab hidden** — the dot animation loop stops when `document.visibilityState` is `hidden` and when the pointer is idle, so it costs nothing at rest. Test in Task 3.
4. **Reduced motion switched on mid-visit** — lean, dots and swing stop without reload (the hook is live). Test in Task 2.
5. **No JavaScript** — the board renders with its plain dot background and fade-up, and no draw button is shown (it is rendered only by the island). Covered by the existing `tests/e2e/site-nojs.spec.ts`; add the draw-button assertion in Task 4.

---

### Task 1: Tiles swing into place as you scroll

**Files:**
- Modify: `app/globals.css` (the `.reveal` rules, ~lines 72–95)
- Test: `tests/e2e/board-motion.spec.ts` (create)

**Interfaces:**
- Produces: keyframes `swing-in`; `.reveal` unchanged as a class name, so `components/board/Reveal.tsx` and `Board.tsx` don't change.

- [ ] **Step 1: Write the failing tests** in `tests/e2e/board-motion.spec.ts`:
  - `"lower tiles swing in on scroll"`: go to `fixtureUrl("full")`, read `getComputedStyle(firstRevealEl).animationName`; expect `"swing-in"` when `CSS.supports("animation-timeline: view()")`, else `"fade-up"`.
  - `"swing is off with reduced motion"`: `page.emulateMedia({ reducedMotion: "reduce" })`, expect `animationName` `"none"`.
  - `"first-screen tiles never animate"`: for the hello tile's wrapper, `animationName` is `"none"`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/board-motion.spec.ts --project=desktop` (with `E2E_SERVERS=site`). Expected: first test FAILS (`fade-up`).
- [ ] **Step 3: Implement** inside the existing `@media (prefers-reduced-motion: no-preference)` block: add `@supports (animation-timeline: view())` that gives `.reveal` `animation: swing-in linear both; animation-timeline: view(); animation-range: entry 0% entry 70%;` and drops the `--i` delay. `swing-in` starts from `opacity: 0; transform: translateY(32px) rotate(-6deg); transform-origin: top left` and ends at rest, with a small overshoot keyframe (~`rotate(1.5deg)` at 80%) for the pressed-on-sticker feel. Without support, today's `fade-up` stays.
- [ ] **Step 4: Run** the same command; expected PASS.
- [ ] **Step 5: Commit** `feat(board): tiles swing into place on scroll`.

### Task 2: Motion island + tiles lean toward the cursor and lift when pressed

**Files:**
- Create: `lib/motion/lean.ts`, `tests/unit/lean.test.ts`
- Create: `components/board/motion/LazyBoardMotion.tsx`, `components/board/motion/BoardMotion.tsx`, `components/board/motion/useLean.ts`
- Modify: `components/board/Board.tsx` (add `data-tile` on each tile wrapper; render `<LazyBoardMotion sunOffsetMinutes={…} />` after the grid — the prop is wired in Task 5, pass `null` until then)
- Modify: `components/board/Tile.tsx` (consume `--lean-x`, `--lean-y`, `--lift` via `transform`)
- Test: `tests/e2e/board-motion.spec.ts`

**Interfaces:**
- Produces: `leanFor(rect: {left:number; top:number; width:number; height:number}, pointer: {x:number; y:number}, maxDeg = 4): { x: number; y: number }` — degrees, each clamped to `[-maxDeg, maxDeg]`, `{0,0}` when the pointer is more than one tile-width outside the rect.
- Produces: `LazyBoardMotion({ sunOffsetMinutes }: { sunOffsetMinutes: number | null })` — loads `BoardMotion` with `import()` after `load` + `requestIdleCallback` (4000 ms fallback), same pattern and comment style as `LazyGame.tsx`.
- Produces: `BoardMotion` renders the island's children (later tasks add `DotField`, `Doodle`, `SunClock`) and calls `useLean(gridEl)`.

- [ ] **Step 1: Unit tests** in `tests/unit/lean.test.ts`: `"pointer at center gives no lean"` → `{x:0,y:0}`; `"pointer at right edge leans right by max"` → `x === 4`; `"result is clamped"` for a pointer 3 widths away inside range → `|x| <= 4`; `"far pointer gives no lean"` → `{0,0}`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/lean.test.ts`; expected FAIL (module missing).
- [ ] **Step 3: Implement** `leanFor` in `lib/motion/lean.ts`.
- [ ] **Step 4: Run**; expected PASS.
- [ ] **Step 5: E2E tests** in `board-motion.spec.ts`: `"tile leans toward cursor"` (desktop: move mouse near a tile, poll its `--lean-x` style ≠ `0` / non-empty); `"press lifts a tile"` (`mouse.down` on a tile → `--lift` set, `mouse.up` → cleared); `"no lean with reduced motion"` — emulate reduce *after* load, move mouse, `--lean-x` stays unset; `"no lean on touch"` (mobile project) — tap sets `--lift` only.
- [ ] **Step 6: Implement** `useLean`: one `pointermove` listener on the grid (`pointerType === "mouse"` and `matchMedia("(pointer: fine)")` only), rAF-throttled, writes `--lean-x`/`--lean-y` on each `[data-tile]`; `pointerdown`/`pointerup`/`pointercancel` toggle `--lift` (e.g. `-4px`) for any pointer type. Off when `useReducedMotion()` is true; clears vars when it turns on. `Tile.tsx` adds `transform: perspective(900px) rotateX(var(--lean-y,0deg)) rotateY(var(--lean-x,0deg)) translateY(var(--lift,0px))` with a short transition; the existing `md:-rotate-*` tilt uses the separate `rotate` property in Tailwind v4, so it is not overwritten — confirm in the browser. A lifted tile's shadow grows one step (use `--shadow-tile` with a larger offset defined as a token, e.g. `--shadow-tile-lift`, light and dark).
- [ ] **Step 7: Run** e2e for desktop and mobile; expected PASS. Check `npm run build` output: home first-load JS unchanged (island is a separate chunk).
- [ ] **Step 8: Commit** `feat(board): tiles lean toward the cursor and lift when pressed`.

### Task 3: Dots move out of your way

**Files:**
- Create: `lib/motion/dots.ts`, `tests/unit/dots.test.ts`, `components/board/motion/DotField.tsx`
- Modify: `components/board/motion/BoardMotion.tsx`

**Interfaces:**
- Produces: `dotPush(dot: {x:number;y:number}, pointer: {x:number;y:number} | null, radius = 120, strength = 10): { dx: number; dy: number }` — pushes away from the pointer, falls off to 0 at `radius`, magnitude ≤ `strength`, `{0,0}` for a null pointer.

- [ ] **Step 1: Unit tests**: `"no pointer, no push"`; `"dot outside radius is still"`; `"push points away from pointer"` (dot right of pointer → `dx > 0`); `"push never exceeds strength"`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/dots.test.ts`; FAIL.
- [ ] **Step 3: Implement** `dotPush`; run; PASS.
- [ ] **Step 4: E2E tests**: `"dot field appears on desktop"` (a `canvas[data-dots]` exists, `aria-hidden`, `pointer-events: none`); `"dot field resizes"` (resize viewport, canvas `width` equals `innerWidth * devicePixelRatio`); `"dot loop stops when idle"` (expose a `data-running` attribute; after 2 s with no pointer movement it is `"false"`); `"no dot field with reduced motion or touch"`.
- [ ] **Step 5: Implement** `DotField`: fixed full-viewport canvas behind content (`z-index` below the grid, above the body background). Draws the same 18px grid, dot size and `--color-dot` color as the body background (read the token with `getComputedStyle`), offset by `dotPush`, only for dots near the pointer; springs back over ~400 ms then stops the rAF loop. Starts only on fine pointer, no reduced motion, page visible. The body's CSS dot background stays as the first-paint and no-JS fallback; the canvas fades in over it so there is no visible jump.
- [ ] **Step 6: Run** e2e; PASS. Commit `feat(board): dots move out of the cursor's way`.

### Task 4: Doodle on the board

**Files:**
- Create: `components/board/motion/Doodle.tsx`
- Modify: `components/board/motion/BoardMotion.tsx`, `tests/e2e/site-nojs.spec.ts`

**Interfaces:**
- Produces: `Doodle()` — a sticker button (from `components/ui/sticker.ts`, with its focus ring) labeled "Draw" fixed near the board's bottom-left (clear of the corner cat at bottom-right), plus "Clear" while in draw mode.

- [ ] **Step 1: E2E tests**: `"draw mode paints a line"` (click "Draw", drag across the board, canvas has non-transparent pixels via `getImageData`); `"escape leaves draw mode and tiles click again"` (in draw mode press Escape, then click the github tile link → navigation to `github.com/masonbair` requested); `"clear wipes the doodle"`; `"doodle is gone after reload"`; `"draw button is a labeled toggle"` (`aria-pressed` flips); in `site-nojs.spec.ts`: `"no draw button without JS"`; mobile project: `"scrolling never draws"` (swipe without draw mode, canvas empty).
- [ ] **Step 2: Run**; FAIL.
- [ ] **Step 3: Implement** `Doodle`: in draw mode a full-viewport canvas overlay takes pointer events (`touch-action: none` only while drawing) and draws a marker-style stroke in `--color-accent-ink` with round caps and slight width jitter for a hand-drawn look; out of draw mode the canvas keeps the drawing but `pointer-events: none`. Escape or the button exits. Nothing is stored or sent. Available with reduced motion too (drawing is not motion).
- [ ] **Step 4: Run**; PASS. Commit `feat(board): doodle on the board`.

### Task 5: The board follows Mason's sun

**Files:**
- Create: `lib/motion/sun.ts`, `tests/unit/sun.test.ts`, `components/board/motion/SunClock.tsx`
- Modify: `lib/board.ts` (add `sunOffsetMinutes: number | null` to `Board`, new dep `zone?: () => Promise<string>` defaulting to `masonTimeZone(serviceClient())` from `lib/hub/events.ts`, settled with fallback `null`), `components/board/Board.tsx` (pass it to `LazyBoardMotion`), `app/globals.css` (sun tokens), `tests/unit/board.test.ts`

**Interfaces:**
- Produces: `utcOffsetMinutes(timeZone: string, now: Date): number`
- Produces: `type SunPhase = "dawn" | "day" | "dusk" | "night"`; `sunPhase(offsetMinutes: number, now: Date): SunPhase` — local hour `[5,8)` dawn, `[8,17)` day, `[17,20)` dusk, else night.
- Consumes: `LazyBoardMotion({ sunOffsetMinutes })` from Task 2.

- [ ] **Step 1: Unit tests** in `tests/unit/sun.test.ts`: `"offset for Lisbon in winter is 0"`, `"offset for New York in winter is -300"`; `"06:30 local is dawn"`, `"12:00 local is day"`, `"18:00 local is dusk"`, `"23:00 local is night"`, `"boundary 08:00 is day"`. In `board.test.ts`: `"zone failure gives null offset"` and `"board never holds a zone name"` (`JSON.stringify(board)` has no `/`-containing zone string).
- [ ] **Step 2: Run** `npx vitest run tests/unit/sun.test.ts tests/unit/board.test.ts`; FAIL.
- [ ] **Step 3: Implement** `utcOffsetMinutes` (via `Intl.DateTimeFormat` `timeZoneName: "longOffset"`), `sunPhase`, and the `getBoard` change (convert zone → offset on the server; only the number reaches the page).
- [ ] **Step 4: Run**; PASS.
- [ ] **Step 5: Implement** `SunClock`: sets `data-sun="<phase>"` on `<html>` at mount and every 10 minutes; nothing when the offset is null. In `globals.css`, `--color-sun` per phase (light and dark), mixed from existing palette tokens (dawn: rose, day: transparent, dusk: tea, night: accent at low alpha), shown as a soft top-of-page wash on `body` through a CSS transition of ~2 s. Text contrast must stay AA everywhere — check with the a11y spec.
- [ ] **Step 6: E2E**: `"sun phase is set"` (`html[data-sun]` is one of the four phases); `"page html holds no zone name"` (raw response for `fixtureUrl("private")` has no `America/`, `Europe/`).
- [ ] **Step 7: Run** e2e + `tests/e2e/a11y.spec.ts`; PASS. Commit `feat(board): colors follow Mason's time of day`.

### Task 6: Whole-batch check

- [ ] **Step 1:** `npm test` and `E2E_SERVERS=site npx playwright test --project=desktop --project=mobile`; all PASS.
- [ ] **Step 2:** `viv check`; every goal green, home LCP ≤2.5 s and speed ≥95. Report before/after numbers (before: home LCP 2.28 s, speed 98).
- [ ] **Step 3:** Use the `browser-testing` skill: screenshots of desktop and phone sizes, reduced motion on and off, and one per sun phase (force `data-sun`), for Mason to review.
- [ ] **Step 4:** Give Mason the merge command; do not merge or push.
