import { readFile } from "node:fs/promises";
import path from "node:path";

export type Place = { city: string; region: string; country: string; private: boolean; updatedAt: string };
export type Bake = { name: string; photo: string | null; bakedAt: string };
export type Photo = { src: string; alt: string };
export type NowData = { place: Place | null; countriesVisited: number; bake: Bake | null; photos: Photo[] };

const PHOTO_SRC = /^\/misc\/[A-Za-z0-9._-]+\.(webp|jpe?g|png)$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && !Number.isNaN(Date.parse(s)) ? s : null;
};
const photoSrc = (v: unknown): string | null => {
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

export async function readNow(): Promise<NowData> {
  try {
    const text = await readFile(path.join(process.cwd(), "content", "now.json"), "utf8");
    return parseNow(JSON.parse(text));
  } catch {
    return parseNow(null);
  }
}
