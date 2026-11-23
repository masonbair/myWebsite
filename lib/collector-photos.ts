import type { SupabaseClient } from "@supabase/supabase-js";
import { photoPins } from "@/content/site";

export const ASSET_ID = /^[A-Za-z0-9_-]{1,200}$/;
/** Where the site serves a visible phone photo; see app/photos/[assetId]/route.ts. */
const COLLECTOR_PHOTO_SRC = /^\/photos\/[A-Za-z0-9_-]{1,200}$/;
export const BOARD_PHOTO_LIMIT = 30;
export const HUB_PHOTO_LIMIT = 24;
// The coffee spot picks the best labeled photo from this many of the newest.
const PLACEMENT_SCAN_LIMIT = 500;

/** Label columns are null until lib/photos/job.ts labels the photo; description is also null when it failed the privacy check. */
export type CollectorPhotoRow = {
  asset_id: string;
  taken_at: string;
  hidden: boolean;
  description: string | null;
  kind: string | null;
  places: string[] | null;
  score: number | null;
  labeled_at: string | null;
};
/** A board photo; same shape as Photo in lib/now.ts. */
export type CollectorPhoto = { src: string; alt: string };

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Only the month and year, so the alt text never says where a photo was taken. */
export function collectorPhotoAlt(takenAt: string): string {
  return `Photo from Mason's phone, ${MONTH.format(new Date(takenAt))}`;
}

/** The site photo for a row, or null when the row is hidden or its asset id or date is not safe to use. */
export function toCollectorPhoto(row: CollectorPhotoRow): CollectorPhoto | null {
  if (row.hidden !== false || !ASSET_ID.test(row.asset_id) || Number.isNaN(Date.parse(row.taken_at))) return null;
  return { src: `/photos/${row.asset_id}`, alt: row.description ?? collectorPhotoAlt(row.taken_at) };
}

/** Asset ids Mason chose by hand for a spot, overriding Claude's pick. */
export type PhotoPins = { coffee?: string; slideshowFirst?: string };
export type PlacedPhotos = { slideshow: CollectorPhoto[]; coffee: CollectorPhoto | null };
export const NO_PLACED_PHOTOS: PlacedPhotos = { slideshow: [], coffee: null };

const isLabeled = (row: CollectorPhotoRow) => row.labeled_at !== null;
const tagged = (row: CollectorPhotoRow, place: string) => isLabeled(row) && (row.places ?? []).includes(place);

// Rows arrive newest first, so on a tie the newer photo wins.
function best(rows: CollectorPhotoRow[], place: string): CollectorPhotoRow | null {
  let top: CollectorPhotoRow | null = null;
  for (const row of rows) if (tagged(row, place) && (top === null || (row.score ?? 0) > (top.score ?? 0))) top = row;
  return top;
}

/**
 * Where each visible photo goes, from rows sorted newest first. The slideshow takes photos tagged for it plus any not
 * labeled yet; the coffee spot takes only the highest-scoring labeled photo tagged for them.
 */
export function placePhotos(rows: CollectorPhotoRow[], pins: PhotoPins = {}): PlacedPhotos {
  const visible = rows.filter((r) => toCollectorPhoto(r) !== null);
  // A pinned photo wins its spot while it is visible; hidden or gone, Claude's pick takes over.
  const pinned = (place: keyof PhotoPins) => visible.find((r) => r.asset_id === pins[place]) ?? null;
  const lead = pinned("slideshowFirst");
  const rest = visible.filter((r) => r !== lead && (!isLabeled(r) || tagged(r, "slideshow")));
  const slideshow = (lead ? [lead, ...rest] : rest).slice(0, BOARD_PHOTO_LIMIT);
  const pick = (row: CollectorPhotoRow | null) => (row ? toCollectorPhoto(row) : null);
  return {
    slideshow: slideshow.map(toCollectorPhoto).filter((p): p is CollectorPhoto => p !== null),
    coffee: pick(pinned("coffee") ?? best(visible, "coffee")),
  };
}

/** Newest phone photos first; hidden ones are left out unless includeHidden (the hub's list). */
export async function readCollectorPhotos(
  client: SupabaseClient,
  { limit, includeHidden = false }: { limit: number; includeHidden?: boolean },
): Promise<CollectorPhotoRow[]> {
  let query = client.from("collector_photo").select("asset_id, taken_at, hidden, description, kind, places, score, labeled_at");
  if (!includeHidden) query = query.eq("hidden", false);
  const { data, error } = await query
    .order("taken_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CollectorPhotoRow[];
}

/** The visible photos for the slideshow and the coffee page. */
export async function readPlacedPhotos(client: SupabaseClient): Promise<PlacedPhotos> {
  return placePhotos(await readCollectorPhotos(client, { limit: PLACEMENT_SCAN_LIMIT }), photoPins);
}

const WIDTHS: readonly number[] = [256, 640, 1080, 1600];
export const DEFAULT_PHOTO_WIDTH = 1600;
/** The route serves only these widths, so each photo has at most four cached variants. */
export const isServedPhotoWidth = (width: number) => WIDTHS.includes(width);

/** The smallest served width at least as wide as asked, so a visitor cannot make the server render arbitrary sizes. */
export function snapPhotoWidth(width: number): number {
  return WIDTHS.find((w) => w >= width) ?? WIDTHS[WIDTHS.length - 1];
}

/** next/image loader for phone photos: the site's own route resizes them, so the image optimizer's 4-hour cache never keeps a hidden photo alive. */
export function collectorPhotoLoader({ src, width }: { src: string; width: number }): string {
  return `${src}?w=${snapPhotoWidth(width)}`;
}

export const isCollectorPhotoSrc = (src: string) => COLLECTOR_PHOTO_SRC.test(src);
