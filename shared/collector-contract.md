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
| Daylio export file | upload to bucket `daylio` at `exports/<file>` | any type, up to 25 MB | fails as a duplicate; treat as already uploaded |
| Health heartbeat | RPC `collector_heartbeat` (`RPC.heartbeat`) | `p_status: { at, items: [{ key, ok }] }` | adds a new row |

## Place rows

| Column | Value |
| --- | --- |
| `city` | GeoNames city name. **`null` inside a private place.** A public row needs a non-empty city. |
| `region` | GeoNames admin1 ASCII name, `''` when there is none. |
| `country` | English country name from GeoNames countryInfo, e.g. `Portugal`. |
| `private` | `true` inside a private place (decided on the phone; private places are stored only on the phone). |
| `time_zone` | The device's IANA zone, e.g. `Europe/Lisbon`, or `null`. Unknown zones are refused. |

The site shows `city, country` for a public place and `region, country` for a private one.

## Paths

- Photos: `collector/<assetId>.jpg`, letters, digits, `_` and `-` only in `<assetId>`. The same path goes in `p_path`.
- Daylio: `exports/<file>`, one level, no `/`, `\` or `..` in `<file>`. The same path goes in `p_path`.

## Who reads what

| Data | Read by |
| --- | --- |
| `now_place`, `collector_photo`, `collector_daylio_export`, `collector_heartbeat` | the site's server only (service role). Mason's session can insert but not read them. |
| `photos` bucket files | anyone, by direct URL: `<SUPABASE_URL>/storage/v1/object/public/photos/collector/<id>.jpg`. Nobody can list the bucket. |
| `daylio` bucket files | the site's server only (service role). |

## Hiding a photo

Photos publish straight away. The undo is on the private side: `collector_set_photo_hidden(p_asset_id, p_hidden)` sets `hidden` and returns `false` when no photo has that asset id. Only Mason's session can call it; `hidden` is the only column that can ever change.
