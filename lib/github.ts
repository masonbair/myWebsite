export type Repo = { name: string; url: string; homepage: string | null; description: string | null; pushedAt: string };
export type GithubActivity = { commits30d: number; repos30d: number; recent: Repo[]; online: Repo[] };

const QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      commitContributionsByRepository { repository { name } }
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

export async function getGithubActivity(
  user = "masonbair",
  fetchImpl: typeof fetch = fetch,
  token = process.env.GITHUB_TOKEN,
  now: Date = new Date(),
): Promise<GithubActivity | null> {
  if (!token) return null;
  try {
    // Hour-aligned so the request body is stable and Next's fetch cache can hit.
    const to = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const res = await fetchImpl("https://api.github.com/graphql", {
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
    return {
      commits30d: Number(c.totalCommitContributions) || 0,
      repos30d: c.commitContributionsByRepository.length,
      recent: repos.slice(0, 3),
      online: repos.filter((r) => r.homepage !== null),
    };
  } catch {
    return null;
  }
}
