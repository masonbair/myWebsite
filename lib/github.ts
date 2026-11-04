import { readFile } from "node:fs/promises";
import path from "node:path";

export type Repo = { name: string; url: string; homepage: string | null; description: string | null; pushedAt: string };
export type GithubActivity = { commits30d: number; private30d: number; total30d: number; repos30d: number; recent: Repo[]; online: Repo[] };

const QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      restrictedContributionsCount
      commitContributionsByRepository { repository { isPrivate } }
    }
    repositories(first: 20, privacy: PUBLIC, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes { name url homepageUrl description pushedAt isFork }
    }
  }
}`;

type RawRepo = {
  name: string;
  url: string;
  homepageUrl: string | null;
  description: string | null;
  pushedAt: string;
  isFork: boolean;
};

// Only https homepages are linked; this blocks javascript: and plain http URLs.
function httpsHomepage(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

function toRepo(r: RawRepo): Repo {
  return {
    name: r.name,
    url: r.url,
    homepage: httpsHomepage(r.homepageUrl),
    description: r.description ?? null,
    pushedAt: r.pushedAt,
  };
}

const FIXTURE_NAME = /^[a-z0-9-]+\.json$/;

// Test-only override set by Playwright; ignored in production and confined to the fixtures folder.
function fixtureFile(): string | null {
  const name = process.env.GITHUB_FIXTURE;
  if (!name || process.env.NODE_ENV === "production" || !FIXTURE_NAME.test(name)) return null;
  return path.join(process.cwd(), "tests", "e2e", "fixtures", name);
}

export async function getGithubActivity(
  user = "masonbair",
  fetchImpl: typeof fetch = fetch,
  token = process.env.GITHUB_TOKEN,
  now: Date = new Date(),
): Promise<GithubActivity | null> {
  const fixture = fixtureFile();
  if (!token && !fixture) return null;
  try {
    // Hour-aligned so the request body is stable and Next's fetch cache can hit.
    const to = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const res = fixture
      ? new Response(await readFile(fixture, "utf8"), { status: 200 })
      : await fetchImpl("https://api.github.com/graphql", {
          method: "POST",
          headers: {
            Authorization: `bearer ${token}`,
            "User-Agent": "masonbair-site",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: QUERY,
            variables: { login: user, from: from.toISOString(), to: to.toISOString() },
          }),
          next: { revalidate: 3600 },
        } as RequestInit);
    if (res.status !== 200) return null;
    const json = await res.json();
    if (json.errors || !json.data?.user) return null;
    const { contributionsCollection: c, repositories } = json.data.user;
    const nodes: RawRepo[] = (repositories.nodes as RawRepo[]).filter((r) => r && !r.isFork);
    const repos = nodes.map(toRepo);
    const commits30d = Number(c.totalCommitContributions) || 0;
    const private30d = Number(c.restrictedContributionsCount) || 0;
    const byRepo: { repository: { isPrivate?: boolean } }[] = c.commitContributionsByRepository;
    return {
      commits30d,
      private30d,
      total30d: commits30d + private30d,
      repos30d: byRepo.filter((x) => x.repository.isPrivate === false).length,
      recent: repos.slice(0, 3),
      online: repos.filter((r) => r.homepage !== null),
    };
  } catch {
    return null;
  }
}
