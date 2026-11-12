import { getGithubActivity, type GithubActivity, type Repo } from "@/lib/github";
import { masonTimeZone } from "@/lib/hub/events";
import { offsetMinutesAt } from "@/lib/hub/schedule";
import { readPublicTrends, type PublicTrends } from "@/lib/news/public";
import { loadNow, parseNow, type NowData } from "@/lib/now";
import { serviceClient } from "@/lib/supabase/server";

/** `sunOffsetMinutes` is Mason's UTC offset; only the number reaches the page, never the zone name. */
export type Board = { now: NowData; github: GithubActivity | null; trends: PublicTrends | null; sunOffsetMinutes: number | null };

type Deps = {
  readNow?: () => Promise<NowData>;
  github?: () => Promise<GithubActivity | null>;
  trends?: () => Promise<PublicTrends | null>;
  zone?: () => Promise<string>;
};

// Promise.resolve().then also catches a source that throws before returning a promise.
const settle = <T,>(source: () => Promise<T>, fallback: T): Promise<T> =>
  Promise.resolve()
    .then(source)
    .catch(() => fallback);

/** Loads everything the Right Now board shows; a failing source becomes its empty value. */
export async function getBoard(deps: Deps = {}): Promise<Board> {
  const [now, github, trends, zone] = await Promise.all([
    settle(deps.readNow ?? (() => loadNow()), parseNow(null)),
    settle(deps.github ?? (() => getGithubActivity()), null),
    settle(deps.trends ?? (() => readPublicTrends()), null),
    settle(deps.zone ?? (() => masonTimeZone(serviceClient())), process.env.HUB_TIME_ZONE || null),
  ]);
  return { now, github, trends, sunOffsetMinutes: zone ? offsetMinutesAt(zone, new Date()) : null };
}

const FULL = "md:col-span-6 lg:col-span-12";
const PAIR = ["md:col-span-3 lg:col-span-8", "md:col-span-3 lg:col-span-4"];

/** Spans for the tiles below the first screen; they pair wide-then-narrow, and an odd first one takes a whole row. */
export function lowerSpans(keys: string[]): Map<string, string> {
  const odd = keys.length % 2 === 1;
  return new Map(keys.map((k, i) => [k, odd && i === 0 ? FULL : PAIR[(i - (odd ? 1 : 0)) % 2]]));
}

export const MAX_BOARD_TILES = 8;

const THIS_SITE = "masonbair.com";

/** Repos with a live link that is not this site; linking to the page the visitor is already on helps nobody. */
export function liveElsewhere(repos: Repo[]): (Repo & { homepage: string })[] {
  return repos.flatMap((r) => {
    if (!r.homepage || !URL.canParse(r.homepage)) return [];
    const host = new URL(r.homepage).hostname.replace(/^www\./, "");
    return host === THIS_SITE ? [] : [{ ...r, homepage: r.homepage }];
  });
}

/** Which tiles below the first screen to show; news gives way first when the board would pass the cap. */
export function lowerKeys(firstScreen: number, has: { projects: boolean; news: boolean; bake: boolean }): string[] {
  const keys = (["projects", "news", "bake"] as const).filter((k) => has[k]);
  return firstScreen + keys.length > MAX_BOARD_TILES ? keys.filter((k) => k !== "news") : [...keys];
}
