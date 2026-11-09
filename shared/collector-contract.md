# Collector data contract

What the Collector phone app writes to Supabase, and who can read it. The names live in `shared/collector-contract.ts`; the database side is `supabase/migrations/0007_collector.sql`.

**Privacy rule: no coordinates, ever.** No table, file, payload or log holds latitude, longitude, an address or anything finer than a city. Photos lose all EXIF (GPS included) on the phone before upload.

## Who writes what

Every write comes from Mason's signed-in session on the phone. The server checks `public.is_owner()` (the `hub_owner` row) on every write; nobody else, signed in or not, can write. Nothing is ever deleted.

| What | How the phone writes it | Columns / arguments | Repeat send |
| --- | --- | --- | --- |
| Current place | insert into `now_place` (`TABLE.place`); do not ask for the row back | `city`, `region`, `country`, `private`, `time_zone` | adds a new row (newest wins) |
| Photo record | RPC `collector_add_photo` (`RPC.addPhoto`) | `p_path`, `p_asset_id`, `p_taken_at`, `p_width`, `p_height` | no-op |
| Photo file | upload to bucket `photos` at `collector/<assetId>.jpg` | JPEG only, up to 25 MB | fails as a duplicate; treat as already uploaded |
| Daylio export record | RPC `collector_add_daylio_export` (`RPC.addDaylioExport`) | `p_path`, `p_filename`, `p_size_bytes`, `p_modified_at` | no-op (same file name, size and modified time) |
| Daylio export file | upload to bucket `daylio` at `daylioPath(...)` | any type, up to 25 MB | fails as a duplicate; treat as already uploaded |
| Health heartbeat | RPC `collector_heartbeat` (`RPC.heartbeat`) | `p_status: { at, items: [{ key, ok }] }`, nothing else | adds a new row |

## Place rows

| Column | Value |
| --- | --- |
| `city` | GeoNames city name. **`null` inside a private place.** A public row needs a non-empty city. |
| `region` | GeoNames admin1 ASCII name, `''` when there is none. |
| `country` | English country name from GeoNames countryInfo, e.g. `Portugal`. |
| `private` | `true` inside a private place (decided on the phone; private places are stored only on the phone). |
| `time_zone` | The device's IANA zone, e.g. `Europe/Lisbon`, or `null`. Unknown zones are refused. |

The site shows `city, country` for a public place and `region, country` for a private one.

## Paths and shapes

- Photos: `collector/<assetId>.jpg`, with letters, digits, `_` and `-` only in `<assetId>` (up to 200). `p_path` must be exactly that.
- Daylio: `daylioPath(filename, sizeBytes, modifiedMs)` gives `exports/<modifiedMs>-<sizeBytes>-<safe filename>`. Each version of a re-exported file gets its own path, so a new export with an old name is never lost. Send `p_modified_at` as `new Date(modifiedMs).toISOString()`; the server checks the path matches the time and size.
- Heartbeat: exactly `{ at, items }`. `at` is an ISO timestamp. Each item is exactly `{ key, ok }`: `key` is 1-40 of `a-z 0-9 : _ -`, `ok` is a boolean. Up to 50 items. Anything else is refused.

## Who reads what

| Data | Read by |
| --- | --- |
| `now_place`, `collector_photo`, `collector_daylio_export`, `collector_heartbeat` | the site's server only (service role). Mason's session can insert but not read them. |
| `photos` bucket files | the site's server only (service role). **Never a public URL.** The site serves photos through its own route, which returns only photos that are not hidden. |
| `daylio` bucket files | the site's server only (service role). |

Backups hold the `collector_photo` and `collector_daylio_export` rows. They do not hold heartbeats or the stored files; the phone keeps the originals.

## Hiding a photo

Photos publish straight away. The undo is on the private side: `collector_set_photo_hidden(p_asset_id, p_hidden)` (`RPC.setPhotoHidden`) sets `hidden` and returns `false` when no photo has that asset id. Only Mason's session can call it; `hidden` is the only column that can ever change.
