import { readFile } from "node:fs/promises";
import path from "node:path";

export const LETTERBOXD_USER = "masonbair";
export const LETTERBOXD_PROFILE = `https://letterboxd.com/${LETTERBOXD_USER}/`;
const FEED = `${LETTERBOXD_PROFILE}rss/`;
const POSTER_HOST = "a.ltrbxd.com";

export type Film = {
  title: string;
  year: string | null;
  watchedOn: string;
  /** Out of 5 in half steps, or null when Mason did not rate it. */
  rating: number | null;
  liked: boolean;
  rewatch: boolean;
  url: string;
  poster: string | null;
  review: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? whole;
  });

const field = (item: string, tag: string) => {
  const m = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1].trim()) : null;
};

// Only links into Mason's own profile and posters from Letterboxd's image host reach the page.
function safeUrl(raw: string | null, host: string, prefix = ""): string | null {
  if (!raw || !URL.canParse(raw)) return null;
  const u = new URL(raw);
  return u.protocol === "https:" && u.hostname === host && u.pathname.startsWith(prefix) ? u.href : null;
}

function toFilm(item: string): Film | null {
  const title = field(item, "letterboxd:filmTitle");
  const watchedOn = field(item, "letterboxd:watchedDate");
  const url = safeUrl(field(item, "link"), "letterboxd.com", `/${LETTERBOXD_USER}/`);
  if (!title || !watchedOn || !/^\d{4}-\d{2}-\d{2}$/.test(watchedOn) || !url) return null;
  const rating = Number(field(item, "letterboxd:memberRating"));
  const body = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ?? "";
  const isReview = field(item, "guid")?.startsWith("letterboxd-review-") ?? false;
  const paragraphs = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((p) => decode(p[1].replace(/<[^>]+>/g, "")).trim())
    .filter(Boolean);
  return {
    title,
    year: field(item, "letterboxd:filmYear"),
    watchedOn,
    rating: rating > 0 && rating <= 5 ? Math.round(rating * 2) / 2 : null,
    liked: field(item, "letterboxd:memberLike") === "Yes",
    rewatch: field(item, "letterboxd:rewatch") === "Yes",
    url,
    // The ?v= cache buster is dropped so next/image can allow posters with no query string at all.
    poster: safeUrl(body.match(/<img src="([^"]+)"/)?.[1] ?? null, POSTER_HOST, "/resized/film-poster/")?.split("?")[0] ?? null,
    review: isReview && paragraphs.length > 0 ? paragraphs.join("\n\n") : null,
  };
}

/** Diary entries from a Letterboxd RSS feed, newest watched first; lists and other items are skipped. */
export function parseLetterboxdFeed(xml: string): Film[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => toFilm(m[1]))
    .filter((f): f is Film => f !== null)
    .sort((a, b) => b.watchedOn.localeCompare(a.watchedOn));
}

/** "★★★½" for a 3.5 rating. */
export function stars(rating: number): string {
  return "★".repeat(Math.floor(rating)) + (rating % 1 ? "½" : "");
}

// Set by Playwright so boards never depend on the live feed; empty means "no films".
async function fixtureFeed(): Promise<string | null | undefined> {
  const name = process.env.LETTERBOXD_FIXTURE;
  if (name === undefined || process.env.NODE_ENV === "production") return undefined;
  if (!/^[a-z0-9-]+\.xml$/.test(name)) return null;
  return readFile(path.join(process.cwd(), "tests", "e2e", "fixtures", name), "utf8");
}

/** Mason's latest films, or an empty list when the feed is down. Cached for an hour. */
export async function getRecentFilms(limit = 4, fetchImpl: typeof fetch = fetch): Promise<Film[]> {
  try {
    const fixture = await fixtureFeed();
    if (fixture === null) return [];
    const xml: string =
      fixture ??
      (await fetchImpl(FEED, { headers: { "User-Agent": "masonbair-site" }, next: { revalidate: 3600 } } as RequestInit).then((res) =>
        res.ok ? res.text() : "",
      ));
    return parseLetterboxdFeed(xml).slice(0, limit);
  } catch {
    return [];
  }
}
