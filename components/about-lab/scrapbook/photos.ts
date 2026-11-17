import "server-only";
import { placePhotos, readCollectorPhotos, toCollectorPhoto, type CollectorPhotoRow } from "@/lib/collector-photos";
import { hasDatabase } from "@/lib/photos/placed";
import { serviceClient } from "@/lib/supabase/server";
import { photoPins } from "@/content/site";

/** A photo sticker; `remote` marks lab fixture photos, which load from the live site. */
export type ScrapPhoto = { src: string; alt: string; caption: string | null; remote?: boolean };

const SCRAP_LIMIT = 6;
const SCAN_LIMIT = 500;
const KINDS = new Set(["portrait", "travel", "event"]);
const KIND_WORD: Record<string, string> = { portrait: "me", travel: "on the road", event: "with friends" };
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function caption(row: CollectorPhotoRow): string {
  const word = row.kind ? KIND_WORD[row.kind] : undefined;
  const when = MONTH.format(new Date(row.taken_at));
  return word ? `${word}, ${when}` : when;
}

/** The About pick first, then the best-scored described photos of people and places. */
export function pickScrapPhotos(rows: CollectorPhotoRow[]): ScrapPhoto[] {
  const lead = placePhotos(rows, photoPins).about;
  const leadRow = lead ? rows.find((r) => toCollectorPhoto(r)?.src === lead.src) : undefined;
  const rest = rows
    .filter((r) => r !== leadRow && r.description && r.kind && KINDS.has(r.kind) && toCollectorPhoto(r))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return [leadRow, ...rest]
    .filter((r): r is CollectorPhotoRow => !!r)
    .slice(0, SCRAP_LIMIT)
    .flatMap((r) => {
      const photo = toCollectorPhoto(r);
      return photo ? [{ ...photo, caption: caption(r) }] : [];
    });
}

// Lab only: real, public Website album photos for local runs, which have no database.
const FIXTURE: ScrapPhoto[] = [
  {
    src: "/photos/26822",
    alt: "Mason smiling over his shoulder in sunglasses and a life jacket, sitting in a boat on a green river between tall forested cliffs.",
    caption: "on the road",
  },
  {
    src: "/photos/26816",
    alt: "Mason smiling in a blue helmet, leaning on a wooden post inside a cave with rows of stalactites and rope railings.",
    caption: "on the road",
  },
  {
    src: "/photos/26831",
    alt: "Mason takes a selfie grinning at a cluttered table with laptops and iced drinks while two friends pose behind him and another person walks by.",
    caption: "with friends",
  },
  {
    src: "/photos/26832",
    alt: "Mason grinning and shouting in a selfie on a wide sandy beach, wearing sunglasses and a green shirt with a crossbody bag, palm trees and buildings behind him.",
    caption: "on the road",
  },
  {
    src: "/photos/26829",
    alt: "Mason stands on a grassy lawn in a black suit and red shirt, with round sunglasses, one hand in his pocket, in front of trees with orange and red leaves.",
    caption: "me",
  },
  {
    src: "/photos/26826",
    alt: "Mason smiling playfully with his tongue out, holding a passport and boarding pass at an airport with a friend in yellow nearby.",
    caption: "with friends",
  },
].map((p) => ({ ...p, remote: true }));

/** Photo stickers from the labeled album; the lab fixture only when there is no database. */
export async function loadScrapPhotos(): Promise<ScrapPhoto[]> {
  if (!hasDatabase()) return process.env.NODE_ENV === "production" ? [] : FIXTURE;
  try {
    return pickScrapPhotos(await readCollectorPhotos(serviceClient(), { limit: SCAN_LIMIT }));
  } catch {
    return [];
  }
}
