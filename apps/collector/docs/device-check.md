# Device check: 2026-11-09

Device: Galaxy Tab A9+ (SM-X115, Android 15), serial R83Y70BSN6V. Release build installed over USB (final: commit 9567bde). The S23 Ultra setup is still to come.

No coordinates appear anywhere below. Place rows are described by region and country only.

## Setup state (read over adb, read-only)

| Item | Result |
|---|---|
| Location | coarse + background granted; fine location not in the manifest |
| Photos | all photos granted |
| Battery | on the unrestricted list |
| Standby bucket | 5 (exempt) |
| Android backup | off (`allowBackup="false"` in the merged release manifest) |
| Extra permissions | SYSTEM_ALERT_WINDOW, READ_MEDIA_AUDIO/VIDEO and WRITE_EXTERNAL_STORAGE are gone from the release manifest |

Health screen: "Everything is running", with every item green.

## Place

| Row | Sent | Private | City | Region, country |
|---|---|---|---|---|
| 1 | 19:30:09Z | false | present | California, United States |
| 2 | 19:30:31Z | true | NULL | California, United States |
| 3 | 19:38:10Z | false | present | California, United States |

- Row 1 is a public ping: city, region and country only. Mason confirmed the city is a travel stop, not home or family.
- Row 2 came from marking that spot private. It carries region and country only, with city NULL and private=true.
- Row 3 came from removing that private place again (Mason's call), so the city shows normally.
- `now_place` has no coordinate columns.
- Root cause of row 1: reporting was switched on before any private place existed. Fixed in a9a9932/9567bde: with no private places, turning reporting on first asks "Are you at home or with family right now?".

Private places marked so far: none. Home and family places are marked later, by Mason, while he is at each one.

## Photo

- Test JPEG with a fake GPS block (0°N 0°E), pushed to `DCIM/Website`, then Run now.
- First attempt: skipped, because Android reported no "date taken" for the file. Fixed in 36f9a5d (falls back to the file's modified time).
- Second attempt: uploaded as `photos/collector/32.jpg`, 1600×1200, with a `collector_photo` row.
- Stored file, downloaded from the private bucket:
  - Segments: APP0 (JFIF), APP2 (ICC_PROFILE), then image data.
  - No APP1/Exif block, no XMP, no `GPS` bytes, 0 EXIF tags.
  - The original had an APP1 Exif block with a GPS section.
- The test row was then hidden (`hidden=true`), and the test file was deleted from the tablet.

## Daylio

- Mason picked `Download/Dailyotest`. The folder grant persisted. A test CSV was pushed there, then Run now.
- Row stored: `exports/1794248556000-119-daylio_export_2026_11_09.csv`, 119 bytes.
- The stored object's SHA-256 matches the test file.
- The test CSV was deleted from the tablet. The row and object stay, because the tables are insert-only.

## Heartbeat

Each run stored a heartbeat with keys and ok flags only. The newest has every key ok.

## Background run (screen off, app in background)

Started at 19:38Z with the app sent to the background. Result: see the section below.
