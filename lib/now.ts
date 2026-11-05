import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export type Place = { city: string; region: string; country: string; private: boolean; updatedAt: string };
export type Bake = { name: string; photo: string | null; bakedAt: string };
export type Photo = { src: string; alt: string };
export type NowData = { place: Place | null; countriesVisited: number; bake: Bake | null; photos: Photo[] };

export const PHOTO_SRC = /^\/misc\/[A-Za-z0-9._-]+\.(webp|jpe?g|png)$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && !Number.isNaN(Date.parse(s)) ? s : null;
};
export const photoSrc = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && PHOTO_SRC.test(s) && !s.includes("..") ? s : null;
};

function parsePlace(raw: unknown): Place | null {
  if (!isObj(raw)) return null;
  const city = str(raw.city);
  const country = str(raw.country);
  const updatedAt = isoDate(raw.updatedAt);
  if (!city || !country || !updatedAt) return null;
  return {
    city,
    region: typeof raw.region === "string" ? raw.region : "",
    country,
    private: raw.private === true,
    updatedAt,
  };
}

function parseBake(raw: unknown): Bake | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name);
  const bakedAt = isoDate(raw.bakedAt);
  if (!name || !bakedAt) return null;
  return { name, photo: photoSrc(raw.photo), bakedAt };
}

function parsePhotos(raw: unknown): Photo[] {
  if (!Array.isArray(raw)) return [];
  const out: Photo[] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const src = photoSrc(item.src);
    const alt = str(item.alt);
    if (src && alt) out.push({ src, alt });
  }
  return out;
}

export function parseNow(raw: unknown): NowData {
  if (!isObj(raw)) return { place: null, countriesVisited: 0, bake: null, photos: [] };
  const n = raw.countriesVisited;
  return {
    place: parsePlace(raw.place),
    countriesVisited: typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0,
    bake: parseBake(raw.bake),
    photos: parsePhotos(raw.photos),
  };
}

const FIXTURE_NAME = /^[a-z0-9-]+\.json$/;

// Test-only override set by Playwright; the strict name check keeps it inside the fixtures folder.
function nowPath(): string {
  const fixture = process.env.NOW_FIXTURE;
  if (fixture && process.env.NODE_ENV !== "production" && FIXTURE_NAME.test(fixture)) {
    return path.join(process.cwd(), "tests", "e2e", "fixtures", fixture);
  }
  return path.join(process.cwd(), "content", "now.json");
}

export async function readNow(): Promise<NowData> {
  try {
    const text = await readFile(nowPath(), "utf8");
    return parseNow(JSON.parse(text));
  } catch {
    return parseNow(null);
  }
}

/** The newest place and latest bake from the database; null fields mean the tables have none yet. */
export type NowRows = { place: Place | null; bake: Bake | null };

/** Reads the now tables as the service role; callers must keep a private place's city off public pages. */
export async function readNowRows(client: SupabaseClient): Promise<NowRows> {
  const [place, bake] = await Promise.all([
    client.from("now_place").select("city, region, country, private, updated_at").order("id", { ascending: false }).limit(1).maybeSingle(),
    client
      .from("now_bake")
      .select("name, photo, baked_at")
      .order("baked_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (place.error) throw place.error;
  if (bake.error) throw bake.error;
  return {
    place: place.data ? parsePlace({ ...place.data, updatedAt: place.data.updated_at }) : null,
    bake: bake.data ? parseBake({ ...bake.data, bakedAt: bake.data.baked_at }) : null,
  };
}

async function databaseRows(): Promise<NowRows | null> {
  // Empty on the e2e site servers and in tests, so they never read a real database.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return readNowRows(serviceClient());
}

type LoadNowDeps = { file?: () => Promise<NowData>; rows?: () => Promise<NowRows | null> };

/** The board's now data: database rows first, then content/now.json for any field the database has none of or fails on. */
export async function loadNow(deps: LoadNowDeps = {}): Promise<NowData> {
  const [file, rows] = await Promise.all([
    (deps.file ?? readNow)(),
    Promise.resolve()
      .then(deps.rows ?? databaseRows)
      .catch(() => null),
  ]);
  return { ...file, place: rows?.place ?? file.place, bake: rows?.bake ?? file.bake };
}
