import type { SupabaseClient } from "@supabase/supabase-js";
import { readNowRows } from "@/lib/now";
import { masonTimeZone } from "./events";

/** Mason's latest place for his own tools; city is null inside a private place. */
export type PrivatePlace = {
  city: string | null;
  region: string;
  country: string;
  timeZone: string;
  private: boolean;
  updatedAt: string;
};

export async function readPrivatePlace(client: SupabaseClient, now = new Date()): Promise<PrivatePlace | null> {
  const { place } = await readNowRows(client);
  if (!place) return null;
  const timeZone = await masonTimeZone(client, now);
  return { city: place.city, region: place.region, country: place.country, timeZone, private: place.private, updatedAt: place.updatedAt };
}
