import { getGithubActivity, type GithubActivity } from "@/lib/github";
import { loadNow, parseNow, type NowData } from "@/lib/now";

export type Board = { now: NowData; github: GithubActivity | null };

type Deps = {
  readNow?: () => Promise<NowData>;
  github?: () => Promise<GithubActivity | null>;
};

// Promise.resolve().then also catches a source that throws before returning a promise.
const settle = <T,>(source: () => Promise<T>, fallback: T): Promise<T> =>
  Promise.resolve()
    .then(source)
    .catch(() => fallback);

/** Loads everything the Right Now board shows; a failing source becomes its empty value. */
export async function getBoard(deps: Deps = {}): Promise<Board> {
  const [now, github] = await Promise.all([
    settle(deps.readNow ?? (() => loadNow()), parseNow(null)),
    settle(deps.github ?? (() => getGithubActivity()), null),
  ]);
  return { now, github };
}
