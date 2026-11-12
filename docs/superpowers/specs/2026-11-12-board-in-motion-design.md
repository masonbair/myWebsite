# Board in Motion — design

Date: 2026-11-12 · Owner: Mason · Source: the "Board in Motion" idea board (https://claude.ai/artifact/7CTHf1AFctsffAE8fRSMwQ) and the brainstorm that followed.

## Why

The home board at masonbair.com is a still Sticker Board. Mason wants a first-time visitor to feel **life, creativity and effort** within 5 seconds:

- **Life** — something moves within the first second and keeps reacting to the visitor. The board feels like it is somewhere real, right now.
- **Creativity** — motion looks handmade, like paper stickers on a board: small wobbles, overshoot, odd angles, stop-motion pacing where it fits. Not slick app easing.
- **Effort** — the more a visitor pokes, the more small, deliberate things they find.

Mason also makes stop-motion travel clips on his phone and wants them on the site.

## Goals

Ten ideas Mason marked "love", shipped in three batches:

### Batch 1 — a board that's alive (no input needed from Mason)
1. **Tiles lean toward the cursor, lift when grabbed.** Tiles tilt a few degrees toward the pointer and lift (bigger offset shadow) on press. Grabbing is a lift, not a free drag that rearranges the grid.
2. **Dots move out of your way.** The board's dotted background bends away from the cursor and springs back.
3. **Doodle on the board.** A visitor can draw on the background with a marker-style line. Private to that visitor, not saved, gone on reload. Needs a visible way to start and clear it; must never block clicking tiles.
4. **The board follows Mason's sun.** Colors (background warmth, shadow length/angle or similar) shift with the time of day where Mason is. Uses his time zone only.
5. **Tiles swing into place as you scroll.** Tiles below the first screen swing in like stickers being pressed on as they enter view. This replaces today's fade-up `Reveal` for those tiles.

### Batch 2 — play
6. **Passport stamp lands on the location tile.** The existing country stamp (`CountryStamp` in `components/board/tiles/LocationTile.tsx`) is pressed on with a thump, ink spread and a small settle.
7. **A real terminal you can type in.** The `$ prompt` style already on tiles becomes a working mini terminal (e.g. `whereami`, `ls projects`, `help`, `coffee`). Commands answer from data the site already shows publicly. Nothing it prints may be more private than what the board already shows.
8. **Sticker burst on "Book a coffee chat".** Clicking the coffee button throws a burst of small stickers from the button.

### Batch 3 — Mason's clips
9. **Photo tile comes alive.** The photo tile plays short silent stop-motion loops alongside (or instead of) the rotating photos.
10. **Travel map with clips on the pins.** Its own page: a map of places Mason has been, each pin opening that place's clips. Linked from the board.

Plus the plumbing batch 3 needs: **posting a clip from his phone, right away.** Mason makes a clip, opens the hub on his phone, uploads it, types the city, and it is live on the photo tile and the map. He can hide or delete any clip from the hub.

## Non-goals (for now)

- Mason's "maybe" ideas: stickers land when the page opens, peel a corner for a secret, postcard stack of clips, work history as a road trip. Revisit after batch 3.
- Skipped: a clip playing behind the hello tile; the cat leaving the game to roam the board.
- The 11 unvoted ideas, including most of the whole-page load and scroll ideas (board tips back, sections pile up, sideways reel, scroll-scrubbed stop-motion, zoom into a tile, tile grows into its page).
- Shared doodles, comments, or anything visitors write that others see.
- Sound.

## Anti-goals (failure even if it works)

- **Slower first paint.** The first-screen tiles (`FIRST_SCREEN` in `components/board/Board.tsx`: hello, location, photo, github) must paint at once, as today. No entrance animation may hide them or delay their paint.
- **Missed site goals.** These are tracked by `viv check` and must stay green: Lighthouse search / agent / accessibility 100, speed ≥95, LCP ≤2.5s on `/` and `/coffee` (today home LCP 2.28s, speed 98).
- **Motion that gets in the way.** Nothing loops forever in peripheral vision, nothing makes a visitor wait, nothing moves text while someone is reading it.
- **Leaking where Mason is.** Phone number and exact location never public; home and family places private. Clips show city level at most, and none at all for a private place.
- **Off-system styling.** Everything uses the Sticker Board tokens and components (see "Constraints").

## Constraints

- **Design system:** read the Sticker Board README (https://claude.ai/artifact/1gk5hP4kJoqKbbr7HJJJBS) first. Tokens live in `app/globals.css`; tiles in `components/board/Tile.tsx`; buttons/tags in `components/ui/sticker.ts`; hub UI in `components/hub/styles.ts`. No new ad-hoc colors or shadows. If the time-of-day effect needs new color steps, add them as tokens, light and dark.
- **Reduced motion:** every effect honors `prefers-reduced-motion` (hook: `lib/use-reduced-motion.ts`). With it on: no lean, no dot bending, no swing (tiles simply appear), stamp and burst become a still end state, clips show a still frame with a play button.
- **Phones and touch:** there is no cursor. Lean and dots fall back to a lift on touch; no motion-sensor permission prompts. Doodle works with a finger only after an explicit "draw" toggle, so scrolling never draws.
- **Keyboard:** everything clickable stays reachable and has the focus ring from `components/ui/sticker.ts`. The terminal is a real text input with a label.
- **Cost of code on first load:** effects that are not needed for first paint load after it (the photo tile already waits for idle time this way — `useAfterFirstPaint` in `components/board/tiles/PhotoTile.tsx`).
- **Next.js version:** this repo runs a newer Next.js than most training data; read `node_modules/next/dist/docs/` before writing code.
- **Process rules:** Mason runs every merge, push, `supabase db push` and secret step himself. Every new migration gets an independent read-only security review before he approves it.

## Clip pipeline (batch 3) — what's decided

- **Source:** clips live on Mason's phone today; there are many. He wants to post each one from his phone right after making it.
- **Where it plugs in:** the site already has a phone photo pipeline: `collector_photo` table (`supabase/migrations/0007_collector.sql`), Supabase storage, served at `/photos/[assetId]` (`app/photos/[assetId]/route.ts`), listed in the hub at `app/hub/(owner)/photos`, with a hidden flag and month-only alt text (`lib/collector-photos.ts`). Clips should follow the same pattern (owner-only upload, hidden flag, served through the site) rather than invent a new one.
- **Upload page:** in the private hub, works well on a phone. Pick a clip, type the city, choose where it shows (photo tile, map, both), post.
- **Before anything is public:** strip all embedded metadata (GPS, device, timestamps) from the file, and shrink it to a short, silent, small loop suitable for the home page.
- **Place:** city level, typed by Mason. No coordinates from the file are ever stored or shown. Map pins sit at the city's center.
- **Control:** hide or delete any clip from the hub.

## Calls made during review (Claude's, not Mason's — check these)

- **Photo tile clips don't loop forever.** The still photo always paints first, so LCP is unchanged. After idle time a clip swaps in, plays 2–3 times, and stops on its last frame. Hover or tap plays it again.
- **Private places block clip posting.** The server checks the typed city against the existing private-place matching (`now_place_privacy`, `supabase/migrations/0005_now.sql`). A match is refused with a plain message. Mason is not trusted to remember.
- **Serving:** clips play from storage through short-lived signed links handed out by the site, so hiding a clip takes effect within the link lifetime (a few minutes). Clips must stay small enough that home page video is not a bandwidth worry; the builder sets the target and reports it.

- **Map pins: only cities with a posted clip.** Past cities from location history are not shown; the map never reveals more travel than Mason chose to post.
- **Terminal: a new tile below the first screen,** loaded after first paint. Takes the board to at most 8 tiles (the `tiles ≤ 8` goal). Existing `$` prompts stay decorative.

Mason approved the design on 2026-11-12 ("looks good") with these calls stated.

## Left to the builder

- Animation library or plain CSS/JS — pick the lightest that gives the handmade feel. Measure the bundle cost.
- Exact spring/wobble values, angles, timings, and how far tiles lean.
- How "Mason's time of day" is known: today's `Place` has no time zone, but `HUB_TIME_ZONE` exists. Either is fine as long as nothing finer than city reaches the page.
- Terminal command list and copy (keep it in Mason's voice; see existing tile copy).
- How clips are converted (in the browser before upload, or on the server) and the target length, size and format. Upload must go straight to storage, since a Vercel function body is capped at 4.5 MB.
- Map library and tiles for the travel map page.
- Batch order inside a batch; each batch ships on its own branch.

## Done means

Per batch: the effects work in a real browser on desktop and a phone-sized viewport, with reduced motion on and off, and `viv check` stays green. Batch 3 also: Mason posts a real clip from his phone and sees it on the board, and a downloaded copy of the public clip has no location metadata.
