import "server-only";
import { cache } from "react";
import { toCollectorPhoto, type CollectorPhoto, type CollectorPhotoRow } from "@/lib/collector-photos";
import { hasDatabase } from "@/lib/photos/placed";
import { serviceClient } from "@/lib/supabase/server";

/** Album photos chosen by hand for a chapter, by asset id (the number in /photos/<id>). */
export const chapterPins = { fullsend: "26836", nomad: "26826" } as const;
export type ChapterPin = keyof typeof chapterPins;
export type ChapterPhotos = Partial<Record<ChapterPin, CollectorPhoto>>;

// Lab-only: local dev has no database, so screenshots borrow the same public photos from the live site.
const fixture: ChapterPhotos = {
  fullsend: {
    src: "https://masonbair.com/photos/26836",
    alt: "Mason with the Fullsend team, seven people in matching navy polo shirts smiling at sunset",
  },
  nomad: {
    src: "https://masonbair.com/photos/26826",
    alt: "Mason smiling playfully with his tongue out, holding a passport and boarding pass at an airport with a friend in yellow nearby.",
  },
};

/** The pinned photos that are still visible in the album; a hidden or missing one leaves its chapter on a sticker. */
export const loadChapterPhotos = cache(async (): Promise<ChapterPhotos> => {
  if (!hasDatabase()) return process.env.NODE_ENV === "production" ? {} : fixture;
  try {
    const { data, error } = await serviceClient()
      .from("collector_photo")
      .select("asset_id, taken_at, hidden, description, kind, places, score, labeled_at")
      .in("asset_id", Object.values(chapterPins))
      .eq("hidden", false);
    if (error) throw error;
    const rows = (data ?? []) as CollectorPhotoRow[];
    const photos: ChapterPhotos = {};
    for (const [pin, id] of Object.entries(chapterPins) as [ChapterPin, string][]) {
      const row = rows.find((r) => r.asset_id === id);
      const photo = row ? toCollectorPhoto(row) : null;
      if (photo) photos[pin] = photo;
    }
    return photos;
  } catch {
    return {};
  }
});
