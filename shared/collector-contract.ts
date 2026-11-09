// Shared by the site (Next.js) and the phone app (Metro), so this file must never import anything.
// The human-readable version is collector-contract.md; keep both in step with supabase/migrations/0007_collector.sql.

export const TABLE = { place: "now_place" } as const;

export const RPC = {
  addPhoto: "collector_add_photo",
  addDaylioExport: "collector_add_daylio_export",
  heartbeat: "collector_heartbeat",
  setPhotoHidden: "collector_set_photo_hidden",
} as const;

export const BUCKET = { photos: "photos", daylio: "daylio" } as const;
export const PHOTO_PREFIX = "collector/";
export const DAYLIO_PREFIX = "exports/";

/** A now_place insert: a private row sends city null (region and country only); a public row needs a non-empty city. */
export type PlaceRow = {
  city: string | null;
  region: string;
  country: string;
  private: boolean;
  time_zone: string | null;
};

/** p_path must be `collector/<p_asset_id>.jpg` (asset id: letters, digits, `_`, `-`); p_taken_at is an ISO timestamp. */
export type AddPhotoArgs = { p_path: string; p_asset_id: string; p_taken_at: string; p_width: number; p_height: number };

/** p_path must be daylioPath(p_filename, p_size_bytes, modifiedMs) and p_modified_at `new Date(modifiedMs).toISOString()`. */
export type AddDaylioExportArgs = { p_path: string; p_filename: string; p_size_bytes: number; p_modified_at: string };

/** at is an ISO timestamp; each key is 1-40 of a-z, 0-9, `:`, `_`, `-`; no other fields are accepted. */
export type HeartbeatArgs = { p_status: { at: string; items: { key: string; ok: boolean }[] } };

function daylioSafeName(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, ".");
}

/** False for a name the server refuses (over 255 characters) or that would be cut in its path (over 200 once made safe). */
export function daylioNameFits(filename: string): boolean {
  return Array.from(filename).length <= 255 && daylioSafeName(filename).length <= 200;
}

/** Where one version of a Daylio export is stored; a re-export with the same name but new size or time gets its own path. */
export function daylioPath(filename: string, sizeBytes: number, modifiedMs: number): string {
  const safe = daylioSafeName(filename).slice(0, 200) || "export";
  return `${DAYLIO_PREFIX}${modifiedMs}-${sizeBytes}-${safe}`;
}
