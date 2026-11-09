import { getGithubActivity, type GithubActivity } from "@/lib/github";
import { readPublicTrends, type PublicTrends } from "@/lib/news/public";
import { loadNow, parseNow, type NowData } from "@/lib/now";

export type Board = { now: NowData; github: GithubActivity | null; trends: PublicTrends | null };

type Deps = {
  readNow?: () => Promise<NowData>;
  github?: () => Promise<GithubActivity | null>;
  trends?: () => Promise<PublicTrends | null>;
};

// Promise.resolve().then also catches a source that throws before returning a promise.
const settle = <T,>(source: () => Promise<T>, fallback: T): Promise<T> =>
  Promise.resolve()
    .then(source)
    .catch(() => fallback);

/** Loads everything the Right Now board shows; a failing source becomes its empty value. */
export async function getBoard(deps: Deps = {}): Promise<Board> {
  const [now, github, trends] = await Promise.all([
    settle(deps.readNow ?? (() => loadNow()), parseNow(null)),
    settle(deps.github ?? (() => getGithubActivity()), null),
    settle(deps.trends ?? (() => readPublicTrends()), null),
  ]);
  return { now, github, trends };
}

const FULL = "md:col-span-6 lg:col-span-12";
const PAIR = ["md:col-span-3 lg:col-span-8", "md:col-span-3 lg:col-span-4"];

/** Spans for the tiles below the first screen; they pair wide-then-narrow, and an odd first one takes a whole row. */
export function lowerSpans(keys: string[]): Map<string, string> {
  const odd = keys.length % 2 === 1;
  return new Map(keys.map((k, i) => [k, odd && i === 0 ? FULL : PAIR[(i - (odd ? 1 : 0)) % 2]]));
}
