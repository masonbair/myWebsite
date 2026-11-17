import "server-only";
import { readCollectorPhotos, toCollectorPhoto, type CollectorPhoto } from "@/lib/collector-photos";
import { hasDatabase } from "@/lib/photos/placed";
import { serviceClient } from "@/lib/supabase/server";

const SCAN_LIMIT = 500;

/** The visible album photos for these asset ids; a hidden, missing or unreadable photo is simply left out. */
export async function loadAnswerPhotos(ids: string[]): Promise<Map<string, CollectorPhoto>> {
  const found = new Map<string, CollectorPhoto>();
  if (!hasDatabase()) return found;
  try {
    const rows = await readCollectorPhotos(serviceClient(), { limit: SCAN_LIMIT });
    for (const row of rows) {
      const photo = ids.includes(row.asset_id) ? toCollectorPhoto(row) : null;
      if (photo) found.set(row.asset_id, photo);
    }
  } catch {
    // No photos is better than a broken About section.
  }
  return found;
}
