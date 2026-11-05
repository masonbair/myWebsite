import { photoSrc, type Place } from "@/lib/now";

export const MAX_BAKE_NAME = 120;
const MIN_BAKED_AT = Date.parse("2000-01-01T00:00:00Z");
// A little slack for a phone clock that runs ahead of the server.
const FUTURE_SLACK_MS = 10 * 60_000;

export type BakeInput = { name: string; photo: string | null; bakedAt: string };

export class NowInputError extends Error {}

/** Checks a "Log a bake" submission; an empty time means now, and a photo must be a /misc image path (no uploads yet). */
export function parseBakeInput(raw: { name?: unknown; photo?: unknown; bakedAt?: unknown }, now: Date): BakeInput {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) throw new NowInputError("A bake needs a name.");
  if (name.length > MAX_BAKE_NAME) throw new NowInputError(`Keep the name under ${MAX_BAKE_NAME} characters.`);

  const photoText = typeof raw.photo === "string" ? raw.photo.trim() : "";
  const photo = photoText ? photoSrc(photoText) : null;
  if (photoText && !photo) throw new NowInputError("The photo must be a file in /misc, like /misc/bread.webp.");

  const timeText = typeof raw.bakedAt === "string" ? raw.bakedAt.trim() : "";
  if (!timeText) return { name, photo, bakedAt: now.toISOString() };
  const time = Date.parse(timeText);
  if (Number.isNaN(time) || time < MIN_BAKED_AT) throw new NowInputError("That time is not a real date.");
  if (time > now.getTime() + FUTURE_SLACK_MS) throw new NowInputError("A bake cannot be in the future.");
  return { name, photo, bakedAt: new Date(time).toISOString() };
}

/** The new now_place row that marks a place private or public; history is never edited, so this is always an insert. */
export function placeRowWithPrivacy(place: Place, makePrivate: boolean) {
  return { city: place.city, region: place.region, country: place.country, private: makePrivate, updated_at: place.updatedAt };
}
