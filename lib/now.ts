import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCollectorPhotoSrc, readBoardPhotos } from "@/lib/collector-photos";
import { serviceClient } from "@/lib/supabase/server";

/** city is null only for a private place: inside one, the phone sends region and country alone. */
export type Place = { city: string | null; region: string; country: string; private: boolean; updatedAt: string };
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
// A bake photo stays /misc only: the hub's bake form checks the file exists in public/.
const slideshowSrc = (v: unknown): string | null => {
  const s = str(v);
  return photoSrc(s) ?? (s !== null && isCollectorPhotoSrc(s) ? s : null);
};

function parsePlace(raw: unknown): Place | null {
  if (!isObj(raw)) return null;
  const isPrivate = raw.private === true;
  const city = str(raw.city);
  const country = str(raw.country);
  const updatedAt = isoDate(raw.updatedAt);
  if ((!city && !isPrivate) || !country || !updatedAt) return null;
  return {
    city,
    region: typeof raw.region === "string" ? raw.region : "",
    country,
    private: isPrivate,
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
    const src = slideshowSrc(item.src);
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

/** A database place also says whether the ping itself was sent as private, which the hub cannot undo. */
export type DbPlace = Place & { sentPrivate: boolean };
/** The newest place and latest bake from the database; null fields mean the tables have none yet. */
export type NowRows = { place: DbPlace | null; bake: Bake | null };

type CurrentPlaceRow = { city: string | null; region: string; country: string; private: boolean; sent_private: boolean; updated_at: string };

/** Reads the now tables as the service role, with the place's privacy already applied; callers still keep a private city off public pages. */
export async function readNowRows(client: SupabaseClient): Promise<NowRows> {
  const [place, bake] = await Promise.all([
    client.rpc("now_current_place").maybeSingle<CurrentPlaceRow>(),
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
  const row = place.data;
  const parsed = row ? parsePlace({ ...row, updatedAt: row.updated_at }) : null;
  return {
    place: parsed && row ? { ...parsed, sentPrivate: row.sent_private === true } : null,
    bake: bake.data ? parseBake({ ...bake.data, bakedAt: bake.data.baked_at }) : null,
  };
}

// Empty on the e2e site servers and in tests, so they never read a real database.
const hasDatabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function databaseRows(): Promise<NowRows | null> {
  return hasDatabase() ? readNowRows(serviceClient()) : null;
}

async function databasePhotos(): Promise<Photo[]> {
  return hasDatabase() ? readBoardPhotos(serviceClient()) : [];
}

type LoadNowDeps = { file?: () => Promise<NowData>; rows?: () => Promise<NowRows | null>; photos?: () => Promise<Photo[]> };

/** The board's now data: database rows first, then content/now.json for any field the database has none of or fails on; phone photos go before the file's. */
export async function loadNow(deps: LoadNowDeps = {}): Promise<NowData> {
  const [file, rows, phonePhotos] = await Promise.all([
    (deps.file ?? readNow)(),
    Promise.resolve()
      .then(deps.rows ?? databaseRows)
      .catch(() => null),
    Promise.resolve()
      .then(deps.photos ?? databasePhotos)
      .catch((): Photo[] => []),
  ]);
  const dbPlace = rows?.place;
  const place: Place | null = dbPlace
    ? { city: dbPlace.city, region: dbPlace.region, country: dbPlace.country, private: dbPlace.private, updatedAt: dbPlace.updatedAt }
    : file.place;
  const seen = new Set(phonePhotos.map((p) => p.src));
  const photos = [...phonePhotos, ...file.photos.filter((p) => !seen.has(p.src))];
  return { ...file, place, bake: rows?.bake ?? file.bake, photos };
}
