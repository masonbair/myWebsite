import type { SupabaseClient } from "@supabase/supabase-js";

export const ASSET_ID = /^[A-Za-z0-9_-]{1,200}$/;
/** Where the site serves a visible phone photo; see app/photos/[assetId]/route.ts. */
const COLLECTOR_PHOTO_SRC = /^\/photos\/[A-Za-z0-9_-]{1,200}$/;
export const BOARD_PHOTO_LIMIT = 12;
export const HUB_PHOTO_LIMIT = 24;

export type CollectorPhotoRow = { asset_id: string; taken_at: string; width: number; height: number; hidden: boolean };
/** A board photo; same shape as Photo in lib/now.ts. */
export type CollectorPhoto = { src: string; alt: string };

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Only the month and year, so the alt text never says where a photo was taken. */
export function collectorPhotoAlt(takenAt: string): string {
  return `Photo from Mason's phone, ${MONTH.format(new Date(takenAt))}`;
}

/** The board photo for a row, or null when the row is hidden or its asset id or date is not safe to use. */
export function toCollectorPhoto(row: CollectorPhotoRow): CollectorPhoto | null {
  if (row.hidden !== false || !ASSET_ID.test(row.asset_id) || Number.isNaN(Date.parse(row.taken_at))) return null;
  return { src: `/photos/${row.asset_id}`, alt: collectorPhotoAlt(row.taken_at) };
}

/** Newest phone photos first; hidden ones are left out unless includeHidden (the hub's list). */
export async function readCollectorPhotos(
  client: SupabaseClient,
  { limit, includeHidden = false }: { limit: number; includeHidden?: boolean },
): Promise<CollectorPhotoRow[]> {
  let query = client.from("collector_photo").select("asset_id, taken_at, width, height, hidden");
  if (!includeHidden) query = query.eq("hidden", false);
  const { data, error } = await query
    .order("taken_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CollectorPhotoRow[];
}

/** The visible photos the board shows, newest first. */
export async function readBoardPhotos(client: SupabaseClient): Promise<CollectorPhoto[]> {
  const rows = await readCollectorPhotos(client, { limit: BOARD_PHOTO_LIMIT });
  return rows.map(toCollectorPhoto).filter((p): p is CollectorPhoto => p !== null);
}

const WIDTHS = [256, 640, 1080, 1600] as const;
export const DEFAULT_PHOTO_WIDTH = 1600;

/** The smallest served width at least as wide as asked, so a visitor cannot make the server render arbitrary sizes. */
export function snapPhotoWidth(width: number): number {
  return WIDTHS.find((w) => w >= width) ?? WIDTHS[WIDTHS.length - 1];
}

/** next/image loader for phone photos: the site's own route resizes them, so the image optimizer's 4-hour cache never keeps a hidden photo alive. */
export function collectorPhotoLoader({ src, width }: { src: string; width: number }): string {
  return `${src}?w=${snapPhotoWidth(width)}`;
}

export const isCollectorPhotoSrc = (src: string) => COLLECTOR_PHOTO_SRC.test(src);
