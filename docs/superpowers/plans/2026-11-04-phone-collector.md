# Phone Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One small Expo app on Mason's Galaxy S23 Ultra that, in the background, sends his city/country, new photos from one album (metadata stripped), and Daylio export files to the `masonbair` Supabase project.

**Architecture:** A single-screen Expo app whose real work runs in two background jobs: a movement-driven location task (pattern copied from where_are_my_friends) and a 15-minute periodic task for photos, Daylio files, and a heartbeat. Everything that could reveal location (coordinates, photo metadata) is resolved or removed on the phone; the server only ever receives place names, cleaned JPEGs, and export files. A health screen shows whether Android and Samsung are letting the jobs run, and links straight to the settings that fix them.

**Tech Stack:** Expo SDK 56 (same line as where_are_my_friends: `expo ~56.0.24`, `react-native 0.85.3`), TypeScript, `expo-location`, `expo-task-manager`, `expo-background-task`, `expo-media-library`, `expo-image-manipulator`, `expo-file-system` (Storage Access Framework), `expo-intent-launcher`, `@supabase/supabase-js ^2.107`, `@react-native-async-storage/async-storage`, one local Expo module in Kotlin, Jest via `jest-expo`.

**Spec:** `docs/superpowers/specs/2026-11-03-masonbair-personal-hub-design.md`, section "3. Phone collector app" (plus Goals, Anti-goals, Constraints).

**Reference code (read only, never check out or edit that repo):** `git -C ../where_are_my_friends show feat/city-checkins-auto:<path>` for `src/features/checkins/backgroundTask.ts`, `nearestCity.ts`, `backgroundTask.test.ts`, `app.config.ts`, `index.js`, `docs/runbooks/background-location.md`.

## Global Constraints

- Only city and country (or region and country inside a private place) ever leave the phone. Coordinates never reach the server, database, logs, or any payload. Spec anti-goal: "Precise location leaks."
- Strip EXIF, including GPS, on the phone before upload. Mandatory. If a cleaned file still contains EXIF, it is not uploaded.
- Private places: inside one, send only state/region and country, never the city. Private places are stored only on the phone.
- Photos auto-publish (no approval step). The undo ("hide") lives on the private side, not in this app.
- Daylio is read only from files Mason exports by hand into one folder he picks. The server parses them; the app only uploads.
- Free services only. Supabase project `masonbair`, ref `wsivoyqhtmpnxjakowpi`, free plan.
- Android only (Galaxy S23 Ultra, Android 16, One UI 8.5). Installed by USB as a release build; not published to Play.
- `ACCESS_FINE_LOCATION` is blocked in config, as in where_are_my_friends. Coarse + background location only.
- The app is rarely opened. Nothing may depend on the screen being open.
- Every 15 to 60 minutes is fresh enough. No foreground service, no permanent notification.
- Never touch the where_are_my_friends repo or its Supabase project.
- Package id: `com.masonbair.collector`. App name: "Collector".
- The app lives in the `myWebsite` repo at `apps/collector` (Mason). Every path below is relative to `apps/collector` unless it starts with `shared/`, which is at the repo root.
- Sign-in is GitHub OAuth through Supabase, the same as the website. Only the GitHub user `masonbair` is allowed; the server enforces this, the app only reflects it.
- The data contract is one shared file pair used by both the site and the app: `shared/collector-contract.ts` (types + RPC names) and `shared/collector-contract.md` (the human-readable table below).

## Review Focus

1. **A fix inside a private place that is also near a big city** must report region + country, never the city. The private check runs before any city lookup. Test: `toReport` with a fix 3 km from a private point and 10 km from a city returns `city: null`. (Task 3)
2. **A fix that matches no bundled city** (rural, ocean, flight) must send nothing and keep the last report, not send "unknown". Test in Task 4: `runPlaceTask` with `nearestPlace → null` makes no RPC call and leaves stored state unchanged.
3. **Supabase down or paused** (free projects pause after a week idle) or offline: no crash, the watermark/uploaded set is not advanced, the next run retries, and the health screen shows the age of the last success. Tests in Tasks 5 and 6: an RPC error leaves the asset unmarked.
4. **Photo access downgraded to "selected photos only"** (Android 14+ partial access) or the "Website" album missing/renamed: health shows red with the reason; the job uploads nothing rather than whatever subset it can see. Test in Task 5 and Task 7.
5. **Signed-out or expired session in the background, or a GitHub account other than `masonbair`:** jobs exit quietly, health shows "Signed out". Tests: Task 4 `runPlaceTask` with no session makes no RPC call; Task 1 `signInWithGitHub` with another GitHub user signs out and returns `'not-allowed'`.

---

## What the app needs from Project 2 (the receiving side)

This plan assumes Project 2 builds these in the `masonbair` Supabase project. Task 1 writes them into the shared contract (`shared/collector-contract.ts` and `.md` at the repo root) so the site and the app build against the same file. If Project 2 is not done when this is built, the builder adds them as a migration in the repo's existing Supabase migrations folder (created in the redesign's leaderboard task) and tells Mason (still the `masonbair` project, never where_are_my_friends).

| Need | Shape |
|---|---|
| Auth | Supabase GitHub OAuth provider, the same one the website uses. Every RPC and storage policy below allows only Mason's user (GitHub login `masonbair`). Redirect URL `collector://auth-callback` added to Supabase's allowed redirect list. |
| RPC `collector_report_place` | `(p_city text, p_region text, p_country_code text, p_country text, p_observed_at timestamptz) returns void`. `p_city` is null inside a private place. Rejects any call not from Mason's user. Has no latitude/longitude parameters. |
| Storage bucket `photos` | Mason's user may insert into `collector/`. Read access is Project 2's call (public, since photos auto-publish and are cleaned). |
| RPC `collector_add_photo` | `(p_path text, p_asset_id text, p_taken_at timestamptz, p_width int, p_height int) returns void`. Unique on `p_asset_id`; a repeat call is a no-op, not an error. |
| Storage bucket `daylio` | Private. Mason's user may insert into `exports/`. |
| RPC `collector_add_daylio_export` | `(p_path text, p_filename text, p_size_bytes bigint, p_modified_at timestamptz) returns void`. Unique on `(p_filename, p_size_bytes, p_modified_at)`; repeat is a no-op. |
| RPC `collector_heartbeat` | `(p_status jsonb) returns void`. Stores the latest health snapshot so the private side can warn when the phone goes quiet. |

## File Structure

Paths are relative to `apps/collector/`, except `shared/`, which is at the repo root and also imported by the site.

```
../../shared/collector-contract.ts   RPC names, bucket names, argument types (site + app)
../../shared/collector-contract.md   the contract table above
metro.config.js               watchFolders includes ../../shared so Metro can import it
app.config.ts                 config, permissions, FINE_LOCATION blocked
index.js                      imports both background jobs before registering the app
App.tsx                       the one screen: sign-in, health list, actions
src/lib/supabase.ts           client with AsyncStorage session
src/lib/store.ts              typed AsyncStorage helpers (readJson / writeJson)
src/place/cities.json         generated: [id, name, lat100, lng100, thousands, cc, region]
src/place/countries.json      generated: { "PT": "Portugal", ... }
src/place/nearestPlace.ts     fix -> FoundPlace | null
src/place/privatePlaces.ts    private points on the phone, inside check
src/place/toReport.ts         FoundPlace + private check -> PlaceReport (no coordinates)
src/place/placeTask.ts        location task: define, run, sync on/off
src/photos/hasExif.ts         byte scan for an EXIF APP1 segment
src/photos/cleanPhoto.ts      re-encode to JPEG, guard with hasExif
src/photos/photoJob.ts        scan album, clean, upload, record
src/daylio/daylioJob.ts       scan picked folder, upload new export files
src/jobs/periodicTask.ts      15-minute background task running photo + Daylio + heartbeat
src/health/health.ts          inputs -> HealthItem[] (pure)
src/health/useHealth.ts       gathers inputs on screen
modules/battery-status/       local Expo module: isIgnoringBatteryOptimizations, standbyBucket
scripts/build-cities.ts       GeoNames -> cities.json + countries.json
docs/samsung-setup.md         the setup steps from Task 7
```

---

### Task 1: App skeleton, GitHub sign-in, shared contract

**Files:**
- Create: `app.config.ts`, `metro.config.js`, `index.js`, `App.tsx`, `src/lib/supabase.ts`, `src/lib/signIn.ts`, `src/lib/store.ts`, `jest.config.js`, `.env.example`, `../../shared/collector-contract.ts`, `../../shared/collector-contract.md`
- Test: `src/lib/__tests__/config.test.ts`, `src/lib/__tests__/store.test.ts`, `src/lib/__tests__/signIn.test.ts`

**Interfaces:**
- Produces: `supabase` (SupabaseClient), `signedIn(): Promise<boolean>` in `src/lib/supabase.ts`; `signInWithGitHub(): Promise<'ok' | 'cancelled' | 'not-allowed' | 'error'>` and `signOut(): Promise<void>` in `src/lib/signIn.ts`; `readJson<T>(key: string, fallback: T): Promise<T>`, `writeJson(key: string, value: unknown): Promise<void>` in `src/lib/store.ts`; from `shared/collector-contract.ts`: `RPC` (the four RPC names as constants), `BUCKET` (`photos`, `daylio`), and argument types `ReportPlaceArgs`, `AddPhotoArgs`, `AddDaylioExportArgs`, `HeartbeatArgs` matching the contract table. Later tasks call RPCs only through these constants and types.

- [ ] **Step 1:** Create the Expo app in `apps/collector` (`npx create-expo-app@latest apps/collector --template blank-typescript`), pin SDK 56 to match where_are_my_friends, add `jest-expo`. Install the libraries in the Tech Stack line plus `expo-auth-session` and `expo-web-browser` with `npx expo install`. Make sure the site's build ignores `apps/` (check the root `tsconfig.json` `exclude` and any lint config) so the Next.js build is unaffected.
- [ ] **Step 2: Write the failing tests**
  - `config.test.ts`: the resolved config's `android.package === 'com.masonbair.collector'`; `android.blockedPermissions` contains `android.permission.ACCESS_FINE_LOCATION`; `android.permissions` contains `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `READ_MEDIA_IMAGES`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; the `expo-location` plugin has `isAndroidBackgroundLocationEnabled: true` and `isAndroidForegroundServiceEnabled: false`.
  - `store.test.ts`: `readJson('missing', [])` returns `[]`; corrupt stored JSON returns the fallback; `writeJson` then `readJson` round-trips.
  - `config.test.ts` also: `scheme === 'collector'`.
  - `signIn.test.ts` (mock `supabase.auth` and `expo-web-browser`): `signInWithOAuth` is called with `provider: 'github'`, `options.redirectTo: 'collector://auth-callback'`, `skipBrowserRedirect: true`; a browser result of `success` with a `code` in the URL calls `exchangeCodeForSession(code)` and returns `'ok'`; `cancel`/`dismiss` returns `'cancelled'`; a session whose `user.user_metadata.user_name !== 'masonbair'` is signed out again and returns `'not-allowed'`.
- [ ] **Step 3:** Run `npx jest src/lib` → FAIL.
- [ ] **Step 4:** Implement. `supabase.ts` reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (anon key only; never the service role key), `auth.storage = AsyncStorage`, `persistSession: true`, `autoRefreshToken: true`, `flowType: 'pkce'`, `detectSessionInUrl: false`. `signedIn()` calls `supabase.auth.getSession()` (which refreshes an expired token) and returns whether a session exists. `signInWithGitHub()` opens the URL from `signInWithOAuth` with `WebBrowser.openAuthSessionAsync(url, 'collector://auth-callback')`. The `masonbair` check in the app is only for a clear message; the server's policies are the real gate. `App.tsx`: if signed out, one "Sign in with GitHub" button (and the `not-allowed` message when it applies); if signed in, a placeholder for the health list. `index.js` imports `./src/place/placeTask` and `./src/jobs/periodicTask` (empty stubs for now) before `registerRootComponent(App)`, with the same one-line reason as where_are_my_friends' `index.js`. `metro.config.js` adds the repo root's `shared/` to `watchFolders`.
- [ ] **Step 5:** Write `shared/collector-contract.md` from the "What the app needs from Project 2" table above and `shared/collector-contract.ts` with the matching constants and types. If the site already has a contract file for the private side by then, put these next to it rather than starting a second one.
- [ ] **Step 6:** Run `npx jest` → PASS. `npx tsc --noEmit` → no errors.
- [ ] **Step 7:** Commit `feat: collector app skeleton, GitHub sign-in, shared contract`.

### Task 2: City table with region and country

**Files:**
- Create: `scripts/build-cities.ts`, `src/place/cities.json`, `src/place/countries.json`, `src/place/nearestPlace.ts`
- Test: `src/place/__tests__/nearestPlace.test.ts`

**Interfaces:**
- Produces: `type Point = { latitude: number; longitude: number }`; `type FoundPlace = { city: string; region: string | null; countryCode: string; country: string }`; `nearestPlace(fix: Point): FoundPlace | null`; `kmBetween(a: Point, b: Point): number`.

- [ ] **Step 1: Write the failing tests** (against a small fixture table injected via a second parameter `table?: City[]`, plus 2 checks against the real table):
  - A fix in Islington (51.538, -0.103) returns `city: 'London', countryCode: 'GB', country: 'United Kingdom', region: 'England'` (metro rule: biggest place within 25 km wins).
  - A fix in Lisbon (38.72, -9.14) returns `city: 'Lisbon', countryCode: 'PT'`.
  - A fix more than 40 km from every city returns `null`.
  - NaN, latitude 91, longitude 181 return `null`.
  - The returned object has exactly the keys `city, region, countryCode, country` (no coordinates).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write `scripts/build-cities.ts`: download GeoNames `cities15000.zip`, `admin1CodesASCII.txt`, `countryInfo.txt` (CC BY 4.0; credit GeoNames in the app's About text). Emit `cities.json` rows `[id, name, lat100, lng100, thousands, cc, region]` where region is the admin1 ASCII name, and `countries.json` `{ cc: name }`. Keep the file under ~600 KB. Run it once and commit the output.
- [ ] **Step 4:** Implement `nearestPlace` with the same rules as where_are_my_friends' `nearestCity.ts` (40 km max, 25 km metro rule, flat-earth distance, lazy `require` of the table), returning `FoundPlace`.
- [ ] **Step 5:** Run → PASS. Commit `feat: offline city, region, country lookup`.

### Task 3: Private places and the report shape

**Files:**
- Create: `src/place/privatePlaces.ts`, `src/place/toReport.ts`
- Test: `src/place/__tests__/toReport.test.ts`, `src/place/__tests__/privatePlaces.test.ts`

**Interfaces:**
- Consumes: `Point`, `FoundPlace`, `nearestPlace`, `kmBetween`, `readJson`, `writeJson`.
- Produces: `type PrivatePlace = { label: string; latitude: number; longitude: number; radiusKm: number }`; `loadPrivatePlaces(): Promise<PrivatePlace[]>`; `addPrivatePlace(label: string, at: Point, radiusKm?: number): Promise<void>` (default radius 25); `removePrivatePlace(label: string): Promise<void>`; `type PlaceReport = { city: string | null; region: string | null; countryCode: string; country: string }`; `toReport(fix: Point, privatePlaces: PrivatePlace[], lookup?: typeof nearestPlace): PlaceReport | null`.

- [ ] **Step 1: Write the failing tests**
  - Fix 3 km from a private place and 10 km from a big city → `{ city: null, region: <region>, countryCode, country }`.
  - Fix 30 km from a private place with radius 25 → city is reported.
  - Fix with `lookup` returning `null` → `toReport` returns `null`.
  - `JSON.stringify(toReport(...))` contains neither `latitude` nor `longitude` nor any digit sequence matching the fix's coordinates.
  - `addPrivatePlace` then `loadPrivatePlaces` round-trips; `removePrivatePlace` removes by label.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Private places live under AsyncStorage key `private-places` only. `toReport` checks private places first, then calls `lookup`; inside a private place it still needs region and country, so it uses `lookup`'s result with `city` set to null.
- [ ] **Step 4:** Run → PASS. Commit `feat: private places collapse to region and country`.

### Task 4: Background location task

**Files:**
- Create: `src/place/placeTask.ts` (replaces the Task 1 stub)
- Test: `src/place/__tests__/placeTask.test.ts`

**Interfaces:**
- Consumes: `toReport`, `loadPrivatePlaces`, `supabase`, `signedIn`, `readJson`, `writeJson`.
- Produces: `PLACE_TASK = 'collector-place'`; `runPlaceTask(fixes: { coords: Point }[], now?: number): Promise<void>`; `syncPlaceTask(next: 'on' | 'off'): Promise<void>`; AsyncStorage keys `place-last-sent` (`{ report: PlaceReport; at: number }`) and `job-last-ok:place` (number).

- [ ] **Step 1: Write the failing tests** (mock `supabase.rpc`, `signedIn`, AsyncStorage; model on where_are_my_friends' `backgroundTask.test.ts`):
  - First fix in Lisbon → one `rpc('collector_report_place', { p_city: 'Lisbon', p_region: ..., p_country_code: 'PT', p_country: 'Portugal', p_observed_at: <ISO of now> })`; `place-last-sent` updated; `job-last-ok:place` = now.
  - Same place again within 6 hours → no RPC (only changes are sent), `job-last-ok:place` still updated.
  - Same place after 6 hours → RPC sent again (keeps "last seen" fresh on the site).
  - `toReport` → null → no RPC, stored state unchanged.
  - `signedIn()` false → no RPC, no state change.
  - RPC returns `{ error }` → `place-last-sent` unchanged so the next wake retries.
  - The RPC argument object has no key containing `lat` or `lng`/`lon`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement following where_are_my_friends' `backgroundTask.ts`: `TaskManager.defineTask` at module load (Android only), `startLocationUpdatesAsync(PLACE_TASK, { accuracy: Lowest, distanceInterval: 1000, deferredUpdatesInterval: 15 * 60_000, pausesUpdatesAutomatically: true })`, the queued `syncPlaceTask` so a fast on/off can't leave it running. No foreground service.
- [ ] **Step 4:** Run → PASS. Commit `feat: background place reports`.

### Task 5: Photo album job with on-phone metadata stripping

**Files:**
- Create: `src/photos/hasExif.ts`, `src/photos/cleanPhoto.ts`, `src/photos/photoJob.ts`
- Test: `src/photos/__tests__/hasExif.test.ts`, `src/photos/__tests__/cleanPhoto.test.ts`, `src/photos/__tests__/photoJob.test.ts`, fixtures `src/photos/__tests__/fixtures/with-gps.jpg`, `no-exif.jpg`

**Interfaces:**
- Consumes: `supabase`, `signedIn`, `readJson`, `writeJson`.
- Produces: `hasExif(bytes: Uint8Array): boolean`; `cleanPhoto(uri: string): Promise<{ uri: string; width: number; height: number }>` (throws `ExifRemainsError` if the guard trips); `ALBUM_NAME = 'Website'`; `type PhotoJobResult = { uploaded: number; skipped: number; error: string | null }`; `runPhotoJob(now?: number): Promise<PhotoJobResult>`; AsyncStorage keys `photos-uploaded` (string[] of asset ids, capped at the newest 2,000) and `job-last-ok:photos`.

- [ ] **Step 1: Write the failing tests**
  - `hasExif`: `with-gps.jpg` → true; `no-exif.jpg` → false; random bytes → false. (Scan JPEG segments for an APP1 marker `0xFFE1` whose payload starts with `Exif\0\0`; stop at start-of-scan `0xFFDA`.)
  - `cleanPhoto` (mock `expo-image-manipulator` and file read): re-encodes to JPEG with long edge at most 2400 px, quality 0.85; if the re-encoded bytes still have EXIF it throws `ExifRemainsError`.
  - `runPhotoJob` (mock `expo-media-library`):
    - Album "Website" missing → `{ uploaded: 0, error: 'album-missing' }`, no upload.
    - Permission `accessPrivileges !== 'all'` → `{ error: 'photos-partial-access' }`, no upload.
    - Two new photo assets, one already in `photos-uploaded` → one upload to `photos` bucket at `collector/<assetId>.jpg` and one `rpc('collector_add_photo', { p_path, p_asset_id, p_taken_at, p_width, p_height })`.
    - Videos in the album are skipped.
    - Upload ok but RPC errors → asset id not recorded (retried next run); a storage "already exists" error on retry counts as uploaded.
    - `cleanPhoto` throws `ExifRemainsError` → that asset is skipped and counted, never uploaded, job continues.
    - Signed out → nothing happens, `error: 'signed-out'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Page through `getAssetsAsync({ album, mediaType: 'photo', sortBy: [['creationTime', false]], first: 50 })`, newest first, stop after 20 uploads per run so one run stays short. `p_taken_at` is the asset's creation time. Delete the temporary cleaned file after upload.
- [ ] **Step 4:** Run → PASS. Commit `feat: album photo upload with metadata stripped on the phone`.

### Task 6: Daylio export folder job and the 15-minute periodic task

**Files:**
- Create: `src/daylio/daylioJob.ts`, `src/jobs/periodicTask.ts` (replaces the Task 1 stub)
- Test: `src/daylio/__tests__/daylioJob.test.ts`, `src/jobs/__tests__/periodicTask.test.ts`

**Interfaces:**
- Consumes: `runPhotoJob`, `supabase`, `signedIn`, `readJson`, `writeJson`; `collectHealth` and `sendHeartbeat` from Task 7 are wired in Task 8.
- Produces: `pickDaylioFolder(): Promise<boolean>` (stores the folder URI under `daylio-folder-uri`); `runDaylioJob(now?: number): Promise<{ uploaded: number; error: string | null }>`; `PERIODIC_TASK = 'collector-periodic'`; `runPeriodic(now?: number): Promise<void>` (runs photo job then Daylio job; one failing never stops the other); `registerPeriodic(): Promise<void>` (`expo-background-task`, `minimumInterval: 15` minutes).

- [ ] **Step 1: Write the failing tests**
  - No folder picked → `{ uploaded: 0, error: 'no-folder' }`.
  - Folder has `daylio_export_2026_11_04.csv`, `backup_2026_11_04.daylio`, and `notes.txt` → only the first two upload, to `daylio` bucket `exports/<filename>`, each followed by `rpc('collector_add_daylio_export', { p_path, p_filename, p_size_bytes, p_modified_at })`.
  - A file already recorded under `daylio-uploaded` (key = `filename|size|modified`) is not uploaded again; the same name with a new size or date is.
  - Folder permission revoked (listing throws) → `error: 'folder-access-lost'`, nothing uploaded.
  - `runPeriodic`: photo job throws → Daylio job still runs; both write `job-last-ok:<name>` only on success.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `expo-file-system`'s Storage Access Framework directory picker (persisted permission). Accept `.csv` and `.daylio` only, files up to 50 MB.
- [ ] **Step 4:** Run → PASS. Commit `feat: Daylio export pickup and periodic background job`.

### Task 7: Battery status module, health model, Samsung setup guide

**Files:**
- Create: `modules/battery-status/` (Expo module: `expo-module.config.json`, `android/.../BatteryStatusModule.kt`, `index.ts`), `src/health/health.ts`, `docs/samsung-setup.md`
- Test: `src/health/__tests__/health.test.ts`

**Interfaces:**
- Produces: from `modules/battery-status`: `isIgnoringBatteryOptimizations(): boolean`, `standbyBucket(): number` (`UsageStatsManager.getAppStandbyBucket()`, own app, no extra permission). From `health.ts`: `type HealthInput = { signedIn: boolean; backgroundLocation: 'granted' | 'denied' | 'undetermined'; photosAccess: 'all' | 'limited' | 'none'; daylioFolder: boolean; batteryUnrestricted: boolean; standbyBucket: number; lastOk: Record<'place' | 'photos' | 'daylio', number | null>; now: number }`; `type HealthItem = { key: string; ok: boolean; label: string; fix: 'app-settings' | 'battery-optimization' | 'pick-folder' | 'sign-in' | 'grant-location' | 'grant-photos' | null }`; `evaluateHealth(input: HealthInput): HealthItem[]`; `collectHealth(): Promise<HealthInput>`.

- [ ] **Step 1: Write the failing tests** for `evaluateHealth`:
  - All good → every item `ok: true`.
  - `batteryUnrestricted: false` → battery item not ok, `fix: 'battery-optimization'`.
  - `standbyBucket` 45 (restricted) or 50 → "Samsung has put the app to sleep" item not ok, `fix: 'app-settings'`. Buckets 5, 10, 20, 30, 40 are ok.
  - `photosAccess: 'limited'` → not ok, label says to allow all photos, `fix: 'grant-photos'`.
  - `lastOk.photos` older than 3 hours → not ok, label shows the age in words ("last upload 5 hours ago"); `null` → "never ran".
  - `lastOk.place` older than 24 hours → not ok (location only reports on movement plus every 6 hours, so 24 hours of silence means it stopped).
  - Signed out → only the sign-in item is shown.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the Kotlin module (`PowerManager.isIgnoringBatteryOptimizations(packageName)`, `UsageStatsManager.getAppStandbyBucket()`), then `evaluateHealth` and `collectHealth`. Fix actions: `expo-intent-launcher` opens `ACTION_APPLICATION_DETAILS_SETTINGS` for the app, and `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` with `package:com.masonbair.collector`.
- [ ] **Step 4:** Write `docs/samsung-setup.md` (also shown in-app under "Setup"):
  1. Settings › Apps › Collector › Battery › **Unrestricted**.
  2. Settings › Battery › Background usage limits › **Never auto sleeping apps** › add Collector. Make sure it is not under "Sleeping apps" or "Deep sleeping apps".
  3. Settings › Apps › Collector › Permissions › Location › **Allow all the time**, and leave "Use precise location" **off**.
  4. Settings › Apps › Collector › Permissions › Photos and videos › **Allow all**.
  5. Settings › Apps › Collector › **Pause app activity if unused: off**.
  6. In the app: "Choose Daylio folder", then in Daylio export a CSV into that folder.
- [ ] **Step 5:** Run → PASS. Commit `feat: health checks and Samsung setup guide`.

### Task 8: The one screen and the heartbeat

**Files:**
- Modify: `App.tsx`, `src/jobs/periodicTask.ts`
- Create: `src/health/useHealth.ts`
- Test: `src/__tests__/App.test.tsx`, add to `src/jobs/__tests__/periodicTask.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `sendHeartbeat(items: HealthItem[], now: number): Promise<void>` in `periodicTask.ts` (calls `rpc('collector_heartbeat', { p_status })`, where `p_status` is `{ at, items: [{ key, ok }] }` with no labels containing places).

- [ ] **Step 1: Write the failing tests**
  - Signed in, all healthy → screen shows "Everything is running" and the three last-run ages.
  - One item not ok → that item is listed first with a button whose label matches its `fix` ("Open battery settings", "Allow all photos", ...); pressing it calls the matching intent (mocked).
  - "Mark this place private" asks for a label, takes one current coarse fix, and calls `addPrivatePlace`; the list shows labels only, never coordinates, each with a remove button.
  - "Run now" calls `runPeriodic` and the place sync, then refreshes health.
  - The location switch calls `syncPlaceTask('on' | 'off')`; on is offered only after background location is granted.
  - `runPeriodic` ends by calling `sendHeartbeat` with the evaluated items; a heartbeat RPC error does not throw.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Use the existing palette (indigo `#8783d1` accent on `#f7f6fd`) so it feels like the site; no other design work. Copy is plain and short.
- [ ] **Step 4:** Run `npx jest` (all) and `npx tsc --noEmit` → PASS. Commit `feat: collector screen and heartbeat`.

### Task 9: Install on the phone and prove it end to end

**Files:**
- Create: `docs/device-check.md` (the results)

- [ ] **Step 1:** Confirm Project 2's contract exists in `masonbair` (or apply the fallback migration, after telling Mason), and that `collector://auth-callback` is in Supabase's allowed redirect URLs. Put the anon key and URL in `apps/collector/.env` (gitignored).
- [ ] **Step 2:** Build and install a release build over USB: `npx expo run:android --variant release --device` (phone serial `R5CTC1AW16P`). Use the `running-on-device` skill if it fits. Never run a Play upload.
- [ ] **Step 3:** Mason signs in with GitHub, then does the `docs/samsung-setup.md` steps on the phone (ask him; do not change phone settings over adb). Then open the app: every health item is green. Screenshot it with `adb exec-out screencap -p`.
- [ ] **Step 4: Private places (Mason marks them).** Day one: his home and his family's places (Mason). He marks each one himself with "Mark this place private", either while there or later when he visits; no city or coordinates are written into code, config, or docs. Record only the labels he chose and the count in `docs/device-check.md`. Ask him which ones are still to be marked on a later visit and list those as open.
- [ ] **Step 5: Location.** Press "Run now". In Supabase SQL: the newest place row has city and country, and the table has no numeric columns that could hold coordinates. While inside a private place Mason has marked (or a temporary test place he marks and then removes), run again: the new row has `city IS NULL` and a region.
- [ ] **Step 6: Photos.** Create album `DCIM/Website` with one photo that has GPS (take one with location tagging on). Run now. Download the uploaded object and run `exiftool` on it: no GPS, no EXIF block. Its row exists in the photos table.
- [ ] **Step 7: Daylio.** Export a CSV from Daylio into the picked folder. Run now. The file is in the `daylio` bucket under `exports/` and has a row.
- [ ] **Step 8: Background, no screen.** Close the app (swipe away). Leave the phone on battery for 2 hours. `job-last-ok` ages on the heartbeat row stay under 30 minutes; `adb shell am get-standby-bucket com.masonbair.collector` reports 10 or 20 (not 45/50). Note the result honestly in `docs/device-check.md`, including any run that Android skipped.
- [ ] **Step 9:** Commit `docs: device check results`. Report to Mason with the screenshots and the exiftool output.

---

## Decisions (2026-11-04)

1. **Where the app lives:** inside `myWebsite` at `apps/collector` **(Mason)**. The data contract is shared with the site through `shared/collector-contract.ts` and `.md` at the repo root. The repo is already on the git hook's allowed list, so commits work there.
2. **Sign-in:** GitHub OAuth through Supabase, the same as the website **(Claude's call)**. Replaces the emailed-code sign-in. Single allowed user: GitHub `masonbair`, enforced by the server's policies.
3. **Private places on day one:** his home and his family's places **(Mason)**. Mason marks the exact places himself during phone setup (Task 9, Step 4). No city or coordinates are written into code, config, or docs.
