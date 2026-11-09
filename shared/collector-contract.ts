// Shared by the site (Next.js) and the phone app (Metro), so this file must never import anything.
// The human-readable version is collector-contract.md; keep both in step with supabase/migrations/0007_collector.sql.

export const TABLE = { place: "now_place" } as const;

export const RPC = {
  addPhoto: "collector_add_photo",
  addDaylioExport: "collector_add_daylio_export",
  heartbeat: "collector_heartbeat",
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

/** p_path is `collector/<p_asset_id>.jpg`; p_taken_at is an ISO timestamp. */
export type AddPhotoArgs = { p_path: string; p_asset_id: string; p_taken_at: string; p_width: number; p_height: number };

/** p_path is `exports/<file>`; p_modified_at is an ISO timestamp. */
export type AddDaylioExportArgs = { p_path: string; p_filename: string; p_size_bytes: number; p_modified_at: string };

export type HeartbeatArgs = { p_status: { at: string; items: { key: string; ok: boolean }[] } };
