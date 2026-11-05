# masonbair.com personal hub: design

Date: 2026-11-03. Written from a brainstorm with Mason.

Tags used below:
- **(Mason)**: Mason decided or approved this.
- **(Claude's call)**: suggested by Claude, not yet confirmed by Mason. The builder may follow it but should flag it if it causes trouble.

## Intent

Mason wants masonbair.com to be the one place for his information. Today it is a static résumé-style page. He wants two things from it:

1. **A public front** that shows who he is and what his life looks like right now: where he is, what he is building, what he has been up to. It should feel like him: positive, high energy, inclusive, a baker, a traveler, a digital nomad who has been to 21+ countries.
2. **A private side** that holds his own data (tasks, notes, photos, location, journal) in his own database, instead of spread across other services. AI agents can work with it through one connector.

The site must keep itself current. If updating it needs a laptop and a code change, it will go stale, and the whole idea fails.

## The five projects and build order

These are five projects that share one database and one domain. Build them in this order **(Claude's call, Mason said "looks good")**:

1. Public redesign
2. Private side: database, login, port of todo-hub, agent connector
3. Phone collector app
4. Email
5. Todoist cutover

Projects 1 to 3 feed each other: the public board shows live data that the private side stores and the phone collects. The public board must still look good with no live data yet (see "Empty states" below), so project 1 can ship first.

## Goals

- A visitor understands within a few seconds who Mason is, where he is, and what he is working on.
- Live tiles update without Mason touching code: GitHub activity, current city, photos, last bake.
- New photos reach the site by dropping them into one phone album.
- All tasks, ideas, and notes live in Mason's own Supabase database. Todoist is no longer needed.
- AI agents can read and add to his data through one connector, under clear safety rules.
- He has his own email address on the domain, plus throwaway addresses on demand.

## Non-goals

- A résumé-first site. Work history and the résumé stay, but they are not the lead.
- Showing company work as "projects". Only things that are Mason's own and online.
- A feature-rich phone app. The phone app is a background collector Mason rarely opens.
- Instant updates. Every 15 to 60 minutes is fine for location and photos.

## Anti-goals (failure even if it technically works)

- **The site goes stale.** Any tile that needs a manual code edit to stay current is a failure.
- **Precise location leaks.** Only city and country ever leave the phone. Exact coordinates never reach the server, the database, or the page.
- **An agent sends email.** Never. This carries over from todo-hub.
- **An agent spends money, books anything, deletes or completes a task, or merges/deploys code** without Mason. Carried over from todo-hub.
- **A captured item is lost** during the move off Todoist.
- **It reads as an AI template:** generic layout, purple glow, three equal cards, filler words.

## Constraints

- Free or nearly free services only.
- Domain: masonbair.com. Hosting is Vercel today (`vercel.json`, `.vercel/`).
- Phone: Samsung Galaxy S23 Ultra, Android 16, One UI 8.5.
- Mason builds almost everything through AI agents. Keep tools to ones already in use where possible: Vercel, Supabase, Expo, TypeScript.

---

## 1. Public redesign

### What it looks like (Mason chose option A)

A "Right Now" board: a grid of tiles, like a phone home screen. Reference mockup: `.superpowers/brainstorm/6252-1793742552/content/directions.html`, option A. It is a direction, not a pixel spec.

- One large tile: a photo of Mason and a short hello in his voice ("Hi, I'm Mason." plus one line).
- Smaller tiles, each one live fact:
  - **Currently in:** city and country while traveling, plus a country count. Fed by the phone collector. Mason marks private places (for example home); while he is in one, the tile shows only the state or country. **(Mason)**
  - **GitHub:** real activity numbers (for example commits in the last 30 days across repos). Pulled automatically from his public GitHub account `masonbair`.
  - **Side projects:** personal projects that are online, with live links. Not company work.
  - **Last bake:** name, photo, how long ago.
  - **Photos:** rotating travel and life photos from the album the phone uploads. Photos auto-publish with no approval step **(Mason)**. The private side has a one-tap "hide" per photo as the undo **(Claude's call)**.
- Personality comes through in tone, photos, and motion, not in claims like "I'm high energy".

Below the board (Claude's call): a short about section, then experience, achievements, and the résumé, carried over from the current page in a cleaner form. Keep the current copy's facts; trim it.

### Colors (Mason: same colors, modernized)

Keep the current palette:

| Token | Hex |
|---|---|
| Tropical indigo (main accent) | `#8783d1` |
| Rose quartz | `#aa9aba` |
| Tea rose | `#d1abad` |
| Background | `#f7f6fd` |

"Modernized" means: cleaner spacing, a modern sans-serif type (not Montserrat, not Inter), softer tinted shadows, one radius system, light and dark mode. Indigo stays the one accent. Dark mode is the builder's design call, keeping indigo recognizable.

### Keep from the current site (Mason)

- **The cat-builder game and leaderboard.** Its job: a fun way for visitors to play with the site. It brings out his fun side. Keep it and polish it to match the new design. Where it lives on the page is the builder's call; it should be easy to find but not compete with the hero. The leaderboard becomes shared across all visitors: a Supabase table, with a rate limit and a name filter for offensive names **(Claude's call)**.
- **The `/coffee` redirect** in `vercel.json`.
- **Photos in `misc/`** (already WebP) and the **résumé PDF** (`misc/Mason_Bair_Resume_01_20_2026.pdf`).
- Links to GitHub and LinkedIn.

### Empty states

Every live tile needs a sensible look with no data: last known value with its age, or a still fallback (for example a default photo). The board must never show a broken or blank tile.

### Current stack

- Static `index.html`, `style.css`, `script.js` served by Vercel.
- The README and `.github/workflows/aws.yml`, `.aws/`, `Dockerfile`, `nginx.conf` describe an older AWS ECS pipeline. It is probably no longer used now that Vercel serves the site. **Builder: confirm with Mason before removing it.**
- `.env.local` exists. Check what is in it before deciding anything about secrets.

### Framework (left to the builder)

Recommendation (Claude's call): Next.js on Vercel. Reasons: the private side and the agent connector need server code and login, and Supabase plus Next.js is a well-worn pairing. The builder may choose otherwise with a reason.

---

## 2. Private side

### Decided (Mason)

- Lives at masonbair.com behind a login. Only Mason.
- **Supabase is the database.** His own data, not a third-party app's.
- **It replaces Todoist entirely.** He wants everything in one place.

### Supabase project (Claude's call)

The free plan allows 2 active projects, and where_are_my_friends already uses one. The builder checks for a free slot. If there is none, ask Mason before paying. Do not put this data in the where_are_my_friends project without asking Mason.

### Task states (Claude's call)

Add an **archived** state, separate from done. The worker may archive merged duplicates and split HiDock memos, leaving a "merged into" note that points at the surviving task. Agents still never complete or delete a task. The agent connector enforces this: it exposes archive only for these two cases, and has no complete or delete.

### What moves over from todo-hub

todo-hub lives at `../todo-hub` (design: `../todo-hub/docs/superpowers/specs/2026-10-23-todo-hub-design.md` and the memo-upload and suggested-dates designs next to it). Today it uses Todoist as the store. Port each part to read and write Supabase:

- **Inbox, tasks, ideas, thoughts,** with the same labels: `claude`, `claude-working`, `claude-done`, `claude-question`, `laptop`, `hidock-memo`, project labels.
- **The cloud worker** (`../todo-hub/worker/`): sorts the inbox about 4 times a day, does tasks Mason tags `claude`, posts results as a comment, notifies his phone.
- **The memo relay** `/api/memo`: HiDock voice memo transcripts from phone or Mac.
- **The Claude Code `todo-hub` skill** ("add that to my list", laptop tasks).
- **Granola sweep:** only Mason's own to-dos.
- **Scheduling features** already built: suggested dates, evening budget, late-migrate.

Keep todo-hub's rules: anything that can't be classified stays in the inbox, nothing captured is ever deleted, duplicates from several sources are merged.

### Quick capture (Claude's call)

Leaving Todoist loses its Android widget, voice capture, share button, and reminders. The private side should be an **installable web app** (it can be added to the phone's home screen) with a fast capture screen, voice input, and the share target. Phone notifications for reminders and worker results are needed too; how is the builder's call (web push or the collector app).

### Agent connector (Mason asked for "agent access"; shape is Claude's call)

One MCP server on the site (the same kind of connector Claude uses for Todoist today). Through it, agents can read and add tasks, notes, photos, and other data. Rules, enforced in the connector, not just in prompts:

- Never send email.
- Never spend money or book anything.
- Never delete or complete a task. Mason closes tasks himself.
- Never merge or deploy code.

---

## 3. Phone collector app

### Shape (Mason, confirmed)

Mason described the phone app as "an information collector": it gathers data from his phone and sends it to the site. He will rarely open it. It is **one custom Expo app** (Expo is the toolkit for building phone apps in JavaScript he already uses), reusing the where_are_my_friends location code below.

It does three things:

1. **Location.** Every 15 minutes or so, turn the phone's location into a city and country **on the phone**, and send only that. Reuse `../where_are_my_friends`, branch `feat/city-checkins-auto` (commits c96f54c1, 6c44130a, 9324bd41). Key file: `src/features/checkins/backgroundTask.ts`. It uses `expo-location` and `expo-task-manager`, lowest accuracy, 1 km distance step, 15-minute batches, city matched on the phone, sent with `supabase.rpc`. Notes: `docs/runbooks/background-location.md`. **(Mason: city level while traveling; only state or country inside places he marks private, such as home.)** The phone must decide private-ness itself with home and family geofences and send `private = true`; the server's name matching (`now_place_privacy`) is only the backup.
2. **Photos.** Watch the "Website" album (one subfolder of `DCIM/`, for example `DCIM/Website`) and upload new photos to Supabase Storage. They auto-publish to the site with no approval step **(Mason)**. **Strip EXIF data, including GPS, on the phone before upload. This is mandatory (Claude's call)**, because photo metadata would otherwise leak exact location. A media-library listener only works while the app runs, so check on a timer.

### Later phase (Claude's call)

After the collector works, add more sources. Each is **private by default**. A public tile for any of them is optional later, and Mason opts in per source.

- **Daylio journal.** Daylio cannot be read directly. Mason exports by hand now and then into a watched folder; the app uploads the file and the server parses it.
- **Spotify** recently played, pulled by the server through Spotify's web API.
- **Garmin and Strava** activity, pulled by the server through their web APIs.

### Phone findings (checked over USB, read-only, 2026-11-03)

- Android 16, One UI 8.5.
- Daylio 1.71.1 installed. No backups or exports on the phone. Whether Google Drive backup is on could not be checked.
- Health Connect (Android's built-in health data store) is present but mostly empty. Garmin and Strava have not been given access. Samsung Health is not installed.
- About 20 named album folders under `DCIM/`. "Watch one album" fits this.
- Samsung puts unused background apps into deep sleep. Termux:API is already asleep. where_are_my_friends has been flagged for battery use. The collector must be set to "Unrestricted" battery and kept off the sleeping-apps list; the app should guide Mason to do this.

### Rejected alternatives

| Option | Why not |
|---|---|
| Glue existing apps: GPSLogger (location), HC Webhook (health), a Termux script (photos, Daylio) | Three apps to babysit. Termux:API is already put to sleep by Samsung. GPSLogger sends exact coordinates to the server, which breaks the "only city leaves the phone" rule. Health Connect is nearly empty. |
| Immich, Nextcloud, Syncthing for photos | Need their own always-on server. |
| Ente for photos | Encrypted, so the site can't show the photos. |
| Fully automatic Daylio reading | Not possible: no API, data is private to the app. |

---

## 4. Email

### Wanted (Mason)

- His own address, for example `boss@masonbair.com`.
- Throwaway addresses he can create when needed.

### Approach (Claude's call)

- **Receiving:** Cloudflare Email Routing (free). A catch-all makes any made-up address work right away; spammy ones can be switched off. Mail forwards to Gmail or lands in the private side.
- **Sending:** Resend free tier (about 3,000 emails a month), for Mason's replies and site notifications.
- **Agents may read and sort mail. They never send.** (Claude's call, matching todo-hub's rule.)

### Watch out

- DNS for masonbair.com is at IONOS today, and its mail records point to IONOS mail servers (`mx00.ionos.com`, `mx01.ionos.com`). Mason says an IONOS mailbox is not in use, but he is not sure **(Mason)**. **Before moving DNS to Cloudflare, the builder checks the IONOS account for a mailbox and any mail in it**, so nothing is lost.
- The site's A record points to Vercel. Moving DNS must keep that working.

---

## 5. Todoist cutover

Last, and only after the replacement for phone capture works (installable web app capture, voice, share, notifications).

- Export everything from Todoist into Supabase: tasks, labels, comments, completed history if useful.
- Point every capture path at the new store: Claude Code skill, memo relay, Granola sweep, cloud worker.
- Run both in parallel for a short period, then stop writing to Todoist.
- Nothing captured may be lost in the move.

---

## Left to the builder

- Framework and component choices (Next.js recommended).
- Exact tile set, layout, motion, type, and dark-mode colors, within the direction above.
- Database tables and the agent connector's tool list.
- How notifications reach the phone.
- Whether to delete the old AWS pipeline (ask Mason first).
- How the "last bake" tile gets its data (likely a quick entry from the private side or a tagged photo).

## Open questions for Mason

- Which personal online projects belong on the board.
