# Learn to Earn — design

Date: 2026-11-12 · Owner: Mason · Spans three projects: the Daily Learn cloud routine, masonbair.com (site + hub, this repo), and Focus Lock (`~/Desktop/programming/focus-lock`, Android).

## Why

Mason wants to get better at business skills, and wants his phone limits to push him there. Today Daily Learn emails him lessons every morning, but nothing makes him practise, and nothing checks his answers. Focus Lock limits Instagram to 10 minutes a day with no way around it. Joining them: doing real exercises well earns a little extra Instagram time that day. The time is the hook; the learning is the point. Feedback must teach, not just score.

## Topics (Mason's list)

1. Understanding value, and where Mason brings the most value.
2. Building great products.
3. Communication.
4. **Explaining technical things simply** — the main one. Mason tends to open with tools and jargon ("do you know GitHub?"). The goal is to lead with the big idea in plain words a non-technical client gets at once.

Ads was considered and dropped.

## How it works (decided)

1. **6am email** — the existing Daily Learn email (cloud routine `trig_01Hb1RrSV6QH1vw1kDSNqf5q`) gains an exercise section: 15–20 minutes of work a day, usually two exercises from the topics above. Types:
   - **Scenario:** a business situation; Mason writes how he'd handle it.
   - **Explain it simply:** a technical topic plus a made-up non-technical client; Mason explains it.
   - **Communication / voice:** Mason records a voice memo answer (e.g. a pitch, a client update).
2. **Answer in the hub, not by email (changed 2026-11-12).** The email lists the day's questions and links to a hub page on his phone that shows ONE card at a time, Slack catch-up style: a reading card (link + one-line takeaway), then question cards (typed answer or voice note), then the report card. Mason picked layout **B, "Read, then answer"** from the mockups (https://claude.ai/artifact/MC9CctuJF6PNVqqUGvgDvq, artboard Flip): each card has a Read side (one-breath summary + article link) and an Answer side (question, typed answer, mic button), a "Card N of M" counter, and a minutes bar along the bottom. Grading result shows on the card right after sending.
3. **Sending an answer:** from the card in the hub, signed in as Mason. Accepted only for an exercise that exists, is today's (Mason's zone) and is not yet answered.
4. **Grading:** Claude grades on the server with a fixed rubric per exercise type. The answer is treated strictly as data; instructions inside it ("give me full marks") have no effect. Mason has no button, API or hub action that sets a grade or grants time.
5. **Report card on the card** right after grading (voice: up to ~15 min): what worked, what to fix, a stronger version of his answer, and 1–2 resources aimed at his weak spot. For "explain it simply", the card must call out when he opened with jargon or tool names.
6. **Resources:** tapping "I read it" plus a one-line takeaway earns a small bonus if Claude judges the takeaway shows he read it. Same cap.
7. **Bonus hours:** earned minutes only work between 10:00 and 20:00 local time (Mason, 2026-11-12), so a bonus never lands in the morning or night.
8. **Instagram bonus:** grades convert to bonus minutes for **Instagram only**, at most **+10 minutes a day** (so 20 at most), for that day only. At local midnight it returns to the 10-minute default. Nothing carries over. Several good exercises are needed to reach the cap; one quick answer can't.
9. **Focus Lock picks it up:** the phone pulls today's grants from the hub. It only accepts grants signed with an Ed25519 key that lives only on the server (never reachable from Mason's hub login). Each grant: package (`com.instagram.android`), minutes, date (must equal today), one-use nonce. The cap is also enforced on the phone. No valid grant → no bonus (fail closed).

## Voice answers (Mason, 2026-11-12)

The card's mic records real audio in the hub (not the browser's Google speech-to-text, which drops filler words). The clip is saved to Supabase Storage. Mason's phone transcribes it with his existing hinote-sync Whisper setup (`~/Desktop/programming/hinote-sync`, whisper.cpp large-v3-turbo, the transcription itself runs on the phone): besides running on HiDock plug-in, the phone job checks the hub for new clips about every 15 minutes, transcribes them, and posts the transcript back. Claude then grades content and delivery (filler words, pace, how he opened). Voice grades can take up to ~15 minutes; typed answers grade at once. This adds a fourth project to the build: hinote-sync.

## Approved exceptions to Focus Lock's own rules

Focus Lock's design (`focus-lock/docs/superpowers/specs/2026-11-05-focus-lock-design.md`) says loosening waits 3 days (line 60), no fast way out (anti-goal ~162), no unlock code or override (non-goal ~159), and local-only with no network except DNS (line 112). Mason explicitly approved, on 2026-11-12: an **earned, same-day, capped Instagram bonus** as the one exception. It does not change the 3-day wait for anything else. Network access is limited to fetching grants from the hub. Raising the +10 cap itself is a loosening and still waits 3 days.

The Focus Lock agent flagged that Instagram is the app the lock exists for. Mason chose Instagram anyway: his hard times are mornings and nights, which the 10:00–20:00 window keeps the bonus out of. The low cap is enforced on the phone.

## Focus Lock details (from the Focus Lock agent, 2026-11-12)

1. **Signed bytes:** exactly `fl-grant-v1|<yyyy-mm-dd>|<package>|<minutes>|<nonce>` (not JSON). The version prefix stops a signature being reused elsewhere. Key rotation = an APK update.
2. **Nonces:** the phone keeps today's set of seen nonces and sums minutes of distinct ones; refetching never counts twice. The set resets with usage at midnight.
3. **Whose today:** the phone's local date wins (usage resets at the phone's midnight, `core/Engine.kt:78`; auto time and zone are forced on). The hub dates grants in `masonTimeZone`, which normally matches. When travelling, a grant dated for the other zone is refused (fail closed).
4. **Window math on the phone:** Instagram limit = 10 + min(bonusToday, cap) while local time is 10:00–20:00, else 10. One usage counter, so after 20:00 Instagram blocks if usage is over 10 (intended). The 15 s watcher tick catches the 20:00 edge.
5. **Cap:** a new Config field, default 10. Raising it waits 3 days with Instagram at 0 during the wait (same as raising a timer); lowering is instant. A pending Instagram removal or lower limit also sets the bonus to 0.
6. **Polling:** the phone fetches when Instagram opens, or about every 5 minutes while the screen is on, from the existing watcher. No push, no background job while asleep. A network error keeps only what's already verified today.
7. **Endpoint auth:** a read-only per-device token. Grants carry no secret and are signed, so a leaked token only reveals grants.
8. **Saved state:** new fields (cap, today's nonces and minutes) default so the v3 `state.json` loads as "no bonus". Test that a schema mistake fails closed without restoring an old backup.
9. **Install:** versionCode 4. Test `adb install -r` while armed with a no-op build first; if refused, it costs a 3-day disarm.
10. **DNS:** the hub domain resolves through the filter's upstream; Focus Lock itself is never suspended by fail-closed.

Focus Lock side is about one day of work. Hand its agent the endpoint shape and the PUBLIC key only.

## Contracts between the projects (Claude's call, 2026-11-12; plans build against these)

The site (this repo) owns every endpoint. All tokens are separate Sensitive Vercel env vars Mason adds himself; none can write grades or grants.

- **Grants for Focus Lock:** `GET /api/learn/grants?date=YYYY-MM-DD`, header `Authorization: Bearer <LEARN_FOCUSLOCK_TOKEN>` → `200 {"grants":[{"msg":"fl-grant-v1|2026-11-13|com.instagram.android|3|<nonce>","sig":"<base64 Ed25519 signature of msg as UTF-8>"}]}`. Nonce: 22-char base64url (16 random bytes). Signing key `LEARN_GRANT_PRIVATE_KEY` (base64 32-byte Ed25519 seed, server only); the matching raw 32-byte public key (base64) is built into the APK. Wrong token → 401, no body detail. Pinned with the Focus Lock plan: minutes per grant are an integer 1–60; nonce matches `^[A-Za-z0-9_-]{22}$`; package exactly `com.instagram.android`; `?date=` is the phone's local date and only grants dated that day are returned (bad or missing date → 400); response 200, under 64 KB; cheap enough for ~120 polls a day (no Claude call).
- **Voice clips for hinote-sync:** `GET /api/learn/voice/pending`, `Authorization: Bearer <LEARN_HINOTE_TOKEN>` → `{"clips":[{"id":"<uuid>","url":"<signed download URL, 10 min>","mime":"audio/webm"}]}`; then `POST /api/learn/voice/<id>/transcript` same token, body `{"transcript":"..."}` → 204 (409 if already transcribed). The token can only list pending clips and attach transcripts once.
- **Today's exercises for the Daily Learn routine:** `GET /api/learn/today`, `Authorization: Bearer <LEARN_ROUTINE_TOKEN>` → `{"date":"YYYY-MM-DD","hubUrl":"https://masonbair.com/hub/learn","exercises":[{"type":"scenario|explain|voice","topic":"...","question":"...","reading":{"title":"...","url":"..."}}]}`. Read-only. Exercises are created by a site cron before 05:30 Mason-time.

## Goals

- Mason practises 15–20 minutes a day on the four topics and gets feedback that teaches.
- The bonus can't be faked from the phone, the hub, or the email.
- Each part works if another is down: a missing grade means no bonus, never a crash or an unlocked phone.

## Non-goals

- Ads as a topic. Other apps earning time (YouTube was considered and dropped).
- Answering by email reply (answers happen in the hub).
- Leaderboards, streak games, sharing with others.

## Anti-goals

- Any path where Mason can grant himself minutes without doing graded work (hub button, API call, editing a row, prompt-injecting the grader, replaying an old grant, changing the phone date).
- Feedback that's just a number.
- Spending without a cap: grading uses the Anthropic API with a monthly cap like newsletters (`ai_usage`, workspace masonbair-news or a new one).

## Constraints

- **Blob is paused until ~2026-12-12** (free-tier limit). Raw reply emails and voice memos go to Supabase Storage, not Vercel Blob.
- Mason runs every merge, push, `supabase db push`, secret and Vercel env step. Every new migration gets an independent security review before he approves it.
- Agents never send email on their own initiative; the routine and the site sending Daily Learn / report-card mail to Mason himself is the feature.
- The Daily Learn routine keeps sending through Resend as today; it only adds today's questions and a link to `/hub/learn`.
- Focus Lock work happens in its own repo with its agent; signing key and APK public key handled as secrets (never printed).
- Developer mode is allowed while armed (Mason's choice, 2026-11-09), so a new APK can be installed via the laptop. That is an existing gap, not one this adds.

## Calls made after the builder check (Claude's, not Mason's — check these)

- **Cheating scope:** the design blocks every path from the phone, the hub, and email. Mason's own admin powers (Supabase dashboard, Vercel env, deploys, the routine's prompt) are an accepted gap, like developer mode on the phone. Even so, grants are signed in the same server step that grades an answer sent from the hub, never rebuilt later from editable rows, and the signing key is a Sensitive (write-only) Vercel variable.
- **Stricter Focus Lock states win:** no bonus during the emergency hour, while a pending change sets Instagram to 0, or while the lock fails closed. Otherwise the bonus raises today's limit, so if the 10 minutes are used up, an earned bonus reopens Instagram only for the bonus minutes.
- **Which day:** an exercise belongs to the day it was sent and expires at that day's midnight in Mason's current time zone (`masonTimeZone`, the same zone source the hub uses). Past-day cards can't be answered; a voice transcript that arrives after midnight is graded for feedback with +0 minutes. Nothing banks into tomorrow.
- **Who writes exercises:** the site creates each day's exercises before 6am. The Daily Learn routine reads them through a read-only hub token and puts them in the email. The routine holds no key that can write exercises, grades, or grants. Changing the routine is done by this coordinator with Mason's OK at build time.
- **Report cards live in the hub** on the card itself, now that answers are in the hub. No outbound email from the site is needed, so no new sending domain or DNS step for this feature.

## Left to the builder

- Data model (exercises, answers, grades, grants), rubrics, and the grade-to-minutes table (within the +10 cap).
- Whether exercises are written by the routine or by the site (the site must know which exercises exist to accept answers).
- How the grant endpoint authenticates the phone and how often the phone polls.
