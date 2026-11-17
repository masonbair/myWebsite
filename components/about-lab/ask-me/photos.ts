import "server-only";
import { readCollectorPhotos, toCollectorPhoto, type CollectorPhoto } from "@/lib/collector-photos";
import { hasDatabase } from "@/lib/photos/placed";
import { serviceClient } from "@/lib/supabase/server";

/** An answer's photo; `remote` means it comes from the live site because this server has no database. */
export type AnswerPhoto = CollectorPhoto & { remote: boolean };

const SCAN_LIMIT = 500;

// Lab only: real public album photos, so local screenshots show photos without a database.
const FIXTURE: Record<string, string> = {
  "26816": "Mason smiling in a blue helmet, leaning on a wooden post inside a cave with rows of stalactites and rope railings.",
  "26823": "Mason in a white hood, blue shirt and shorts, grinning beside a friend in a pink outfit and yellow paper crown.",
  "26826": "Mason smiling playfully with his tongue out, holding a passport and boarding pass at an airport with a friend in yellow nearby.",
  "26832":
    "Mason grinning and shouting in a selfie on a wide sandy beach, wearing sunglasses and a green shirt with a crossbody bag, palm trees and buildings behind him.",
  "26836": "Mason with the Fullsend team, seven people in matching navy polo shirts smiling at sunset",
};

/** The visible album photos for these asset ids; a hidden, missing or unreadable photo is simply left out. */
export async function loadAnswerPhotos(ids: string[]): Promise<Map<string, AnswerPhoto>> {
  const found = new Map<string, AnswerPhoto>();
  if (!hasDatabase()) {
    for (const id of ids) if (FIXTURE[id]) found.set(id, { src: `/photos/${id}`, alt: FIXTURE[id], remote: true });
    return found;
  }
  try {
    const rows = await readCollectorPhotos(serviceClient(), { limit: SCAN_LIMIT });
    for (const row of rows) {
      const photo = ids.includes(row.asset_id) ? toCollectorPhoto(row) : null;
      if (photo) found.set(row.asset_id, { ...photo, remote: false });
    }
  } catch {
    // No photos is better than a broken About section.
  }
  return found;
}
