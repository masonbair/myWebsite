import "server-only";
import { cache } from "react";
import { NO_PLACED_PHOTOS, readPlacedPhotos, type PlacedPhotos } from "@/lib/collector-photos";
import { serviceClient } from "@/lib/supabase/server";

// Empty on the e2e site servers and in tests, so they never read a real database.
export const hasDatabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/** The album photos for each spot on the site, read once per render; a database failure shows no photos rather than an error. */
export const loadPlacedPhotos = cache(async (): Promise<PlacedPhotos> => {
  if (!hasDatabase()) return NO_PLACED_PHOTOS;
  try {
    return await readPlacedPhotos(serviceClient());
  } catch {
    return NO_PLACED_PHOTOS;
  }
});
