import type { SupabaseClient } from "@supabase/supabase-js";
import { capUsd, newsCapSpend } from "./budget";
import type { IssueStatus } from "./types";

export type IssueRow = { id: string; subject: string; receivedAt: string; status: IssueStatus; lastError: string | null };
export type SourceIssues = { sourceId: string; sourceName: string; issues: IssueRow[] };
export type QuarantinedRow = { id: string; from: string; subject: string; receivedAt: string };
export type Costs = { thisMonth: number; lastMonth: number; perIssue: number | null };

export type NewsOverview = {
  issues: SourceIssues[];
  quarantined: QuarantinedRow[];
  costThisMonth: number | null;
  costLastMonth: number | null;
  costPerIssue: number | null;
  cap: number;
  paused: boolean;
  suggestedTopics: { topic: string; count: number }[];
};

export type NewsOverviewDeps = {
  costs?: () => Promise<Costs>;
  pausedMonth?: () => Promise<string | null>;
};

type IssueDbRow = { id: string; subject: string; received_at: string; status: IssueStatus; last_error: string | null };

const PER_SOURCE = 10;
const UNMATCHED = "unmatched";

// Without generated database types, embedded relations are inferred as arrays, so the row type is stated by the caller.
async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as T[] | null) ?? [];
}

/** Everything the owner's news page shows, read with the owner's session so row security applies. */
export async function readNewsOverview(client: SupabaseClient, now: Date, deps: NewsOverviewDeps = {}): Promise<NewsOverview> {
  const issueColumns = "id, subject, received_at, status, last_error";
  const latest = (sourceId: string | null) => {
    const q = client.from("news_issues").select(issueColumns).neq("status", "quarantined");
    return rows<IssueDbRow>((sourceId === null ? q.is("source_id", null) : q.eq("source_id", sourceId)).order("received_at", { ascending: false }).limit(PER_SOURCE));
  };
  const [sources, quarantined, stories, costs, pausedMonth] = await Promise.all([
    rows<{ id: string; name: string }>(client.from("news_sources").select("id, name")),
    rows<{ id: string; from_address: string; subject: string; received_at: string }>(
      client
        .from("news_issues")
        .select("id, from_address, subject, received_at")
        .eq("status", "quarantined")
        .order("received_at", { ascending: false })
        .limit(100),
    ),
    rows<{ suggested_topic: string | null }>(client.from("news_stories").select("suggested_topic").not("suggested_topic", "is", null).limit(2000)),
    deps.costs ? deps.costs().catch(() => null) : Promise.resolve(null),
    deps.pausedMonth ? deps.pausedMonth().catch(() => null) : Promise.resolve(null),
  ]);

  // One query per source, so a busy newsletter can never push a slow one's older failed issue out of view.
  const perSource = await Promise.all([...sources.map((s) => latest(s.id)), latest(null)]);
  const toRow = (row: IssueDbRow): IssueRow => ({
    id: row.id,
    subject: row.subject,
    receivedAt: row.received_at,
    status: row.status,
    lastError: row.status === "failed" ? row.last_error : null,
  });
  const groups: SourceIssues[] = [];
  sources.forEach((s, i) => {
    if (perSource[i].length > 0) groups.push({ sourceId: s.id, sourceName: s.name, issues: perSource[i].map(toRow) });
  });
  const unmatched = perSource[sources.length];
  if (unmatched.length > 0) groups.push({ sourceId: UNMATCHED, sourceName: "Unmatched sender", issues: unmatched.map(toRow) });

  const counts = new Map<string, number>();
  for (const { suggested_topic } of stories) {
    if (suggested_topic) counts.set(suggested_topic, (counts.get(suggested_topic) ?? 0) + 1);
  }

  return {
    issues: groups,
    quarantined: quarantined.map((r) => ({ id: r.id, from: r.from_address, subject: r.subject, receivedAt: r.received_at })),
    costThisMonth: costs?.thisMonth ?? null,
    costLastMonth: costs?.lastMonth ?? null,
    costPerIssue: costs?.perIssue ?? null,
    cap: capUsd(process.env),
    paused: pausedMonth === now.toISOString().slice(0, 7),
    suggestedTopics: [...counts].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)).slice(0, 20),
  };
}

export type SearchQuery = {
  text?: string;
  topic?: string;
  company?: string;
  ticker?: string;
  source?: string;
  from?: string;
  to?: string;
  limit: number;
};
export type CompanyRef = { id: number; name: string; ticker: string | null };
export type StoryHit = {
  id: number;
  headline: string;
  topics: string[];
  companies: CompanyRef[];
  tone: number;
  date: string;
  source: string;
  sourceName: string;
  link: string | null;
  issueId: string | null;
};
export type TrendPoint = { bucket: string; stories: number; mentions: number; tone: number | null };
export type TrendQuery = { kind: "topic" | "company"; key: string; from: string; to: string; by: "day" | "week" | "month" };
export type Mover = {
  kind: "topic" | "company";
  key: string;
  label: string;
  recentStories: number;
  previousStories: number;
  coverage: "more" | "less";
};
export type IssueDetail = {
  id: string;
  source: string | null;
  sourceName: string | null;
  subject: string;
  receivedAt: string;
  publishedOn: string | null;
  status: IssueStatus;
  text: string;
  textTruncated: boolean;
  stories: (Omit<StoryHit, "source" | "sourceName" | "issueId"> & { kind: string })[];
};
export type CostMonth = { month: string; total: number; byPurpose: Record<string, number>; byModel: Record<string, number> };
export type CostSummary = { cap: number; capSpendThisMonth: number; months: CostMonth[] };

export type NewsReader = {
  search(q: SearchQuery): Promise<StoryHit[]>;
  trend(q: TrendQuery): Promise<TrendPoint[]>;
  movers(q: { days: number; limit: number }): Promise<Mover[]>;
  getIssue(id: string): Promise<IssueDetail | null>;
  costs(months: number): Promise<CostSummary>;
};

type StoryDbRow = {
  id: number;
  run_id: number;
  source_id: string;
  story_date: string;
  headline: string;
  topics: string[];
  company_ids: number[];
  sentiment: number;
  link: string | null;
  cluster_id: number | null;
  issue_id: string | null;
  news_issues: { current_run_id: number | null } | null;
  news_shared: { current_run_id: number | null; url: string } | null;
};

const STORY_COLUMNS =
  "id, run_id, source_id, story_date, headline, topics, company_ids, sentiment, link, cluster_id, issue_id, news_issues(current_run_id), news_shared(current_run_id, url)";
const PAGE = 500;
const MAX_PAGES = 20;
const COMPANY_MATCH_LIMIT = 50;
const MAX_ISSUE_TEXT = 60_000;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const isCurrent = (r: StoryDbRow) => r.run_id === (r.news_issues?.current_run_id ?? r.news_shared?.current_run_id ?? null);
const cents = (n: number) => Math.round(n * 100) / 100;

/** Read-only news queries for the hub connector, run with the service client and bounded by date range and page count. */
export function createNewsReader(client: SupabaseClient, now: () => Date = () => new Date()): NewsReader {
  type Filter = (q: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

  async function currentStories(filter: Filter, order: "asc" | "desc", wanted: number): Promise<StoryDbRow[]> {
    const out: StoryDbRow[] = [];
    for (let page = 0; page < MAX_PAGES && out.length < wanted; page++) {
      const base = client.from("news_stories").select(STORY_COLUMNS).eq("kind", "news");
      const batch = await rows<StoryDbRow>(
        filter(base)
          .order("story_date", { ascending: order === "asc" })
          .order("id", { ascending: order === "asc" })
          .range(page * PAGE, page * PAGE + PAGE - 1),
      );
      out.push(...batch.filter(isCurrent));
      if (batch.length < PAGE) break;
    }
    return out;
  }

  async function companyIds(match: { name?: string; ticker?: string }): Promise<number[]> {
    let q = client.from("news_companies").select("id").limit(COMPANY_MATCH_LIMIT);
    if (match.name) q = q.ilike("name", `%${likeEscape(match.name)}%`);
    if (match.ticker) q = q.ilike("ticker", likeEscape(match.ticker));
    return (await rows<{ id: number }>(q)).map((r) => r.id);
  }

  async function companyMap(ids: number[]): Promise<Map<number, Omit<CompanyRef, "id">>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const found = await rows<{ id: number; name: string; ticker: string | null; ticker_verified: boolean }>(
      client.from("news_companies").select("id, name, ticker, ticker_verified").in("id", unique),
    );
    return new Map(found.map((c) => [c.id, { name: c.name, ticker: c.ticker_verified ? c.ticker : null }]));
  }

  const refs = (ids: number[], map: Map<number, Omit<CompanyRef, "id">>): CompanyRef[] =>
    ids.flatMap((id) => {
      const c = map.get(id);
      return c ? [{ id, name: c.name, ticker: c.ticker }] : [];
    });

  async function sourceNames(): Promise<Map<string, string>> {
    return new Map((await rows<{ id: string; name: string }>(client.from("news_sources").select("id, name"))).map((s) => [s.id, s.name]));
  }

  return {
    async search(q) {
      let companies: number[] | null = null;
      if (q.company || q.ticker) {
        companies = await companyIds({ name: q.company, ticker: q.ticker });
        if (companies.length === 0) return [];
      }
      const filter: Filter = (query) => {
        if (q.text) query = query.ilike("headline", `%${likeEscape(q.text)}%`);
        if (q.topic) query = query.contains("topics", [q.topic]);
        if (companies) query = query.overlaps("company_ids", companies);
        if (q.source) query = query.eq("source_id", q.source);
        if (q.from) query = query.gte("story_date", q.from);
        if (q.to) query = query.lte("story_date", q.to);
        return query;
      };
      const found = (await currentStories(filter, "desc", q.limit)).slice(0, q.limit);
      const [map, names] = await Promise.all([companyMap(found.flatMap((r) => r.company_ids)), sourceNames()]);
      return found.map((r) => ({
        id: r.id,
        headline: r.headline,
        topics: r.topics,
        companies: refs(r.company_ids, map),
        tone: r.sentiment,
        date: r.story_date,
        source: r.source_id,
        sourceName: names.get(r.source_id) ?? r.source_id,
        link: r.link ?? r.news_shared?.url ?? null,
        issueId: r.issue_id,
      }));
    },

    async trend(q) {
      const points = await rows<{ bucket: string; stories: number; mentions: number; tone_avg: number | string | null }>(
        client.rpc("news_story_counts", { p_kind: q.kind, p_keys: [q.key], p_from: q.from, p_to: q.to, p_bucket: q.by }),
      );
      return points.map((p) => ({ bucket: p.bucket, stories: p.stories, mentions: p.mentions, tone: p.tone_avg === null ? null : Number(p.tone_avg) }));
    },

    async movers({ days, limit }) {
      const ranked = await rows<{ kind: Mover["kind"]; key: string; recent: number; previous: number }>(
        client.rpc("news_story_movers", { p_days: days, p_limit: limit }),
      );
      const topicKeys = ranked.filter((t) => t.kind === "topic").map((t) => t.key);
      const topicNames = new Map<string, string>();
      if (topicKeys.length > 0) {
        for (const t of await rows<{ slug: string; name: string }>(client.from("news_topics").select("slug, name").in("slug", topicKeys))) {
          topicNames.set(t.slug, t.name);
        }
      }
      const companies = await companyMap(ranked.filter((t) => t.kind === "company").map((t) => Number(t.key)));
      return ranked.map((t) => ({
        kind: t.kind,
        key: t.key,
        label: t.kind === "topic" ? (topicNames.get(t.key) ?? t.key) : (companies.get(Number(t.key))?.name ?? t.key),
        recentStories: t.recent,
        previousStories: t.previous,
        coverage: t.recent > t.previous ? "more" : "less",
      }));
    },

    async getIssue(id) {
      const [issue] = await rows<{
        id: string;
        source_id: string | null;
        subject: string;
        received_at: string;
        published_on: string | null;
        status: IssueStatus;
        clean_text: string;
        current_run_id: number | null;
        news_sources: { name: string } | null;
      }>(
        client
          .from("news_issues")
          .select("id, source_id, subject, received_at, published_on, status, clean_text, current_run_id, news_sources(name)")
          .eq("id", id)
          .limit(1),
      );
      if (!issue) return null;
      const stories =
        issue.current_run_id === null
          ? []
          : await rows<StoryDbRow & { kind: string }>(
              client
                .from("news_stories")
                .select(`${STORY_COLUMNS}, kind`)
                .eq("issue_id", id)
                .eq("run_id", issue.current_run_id)
                .order("id")
                .limit(200),
            );
      const map = await companyMap(stories.flatMap((r) => r.company_ids));
      return {
        id: issue.id,
        source: issue.source_id,
        sourceName: issue.news_sources?.name ?? null,
        subject: issue.subject,
        receivedAt: issue.received_at,
        publishedOn: issue.published_on,
        status: issue.status,
        text: issue.clean_text.slice(0, MAX_ISSUE_TEXT),
        textTruncated: issue.clean_text.length > MAX_ISSUE_TEXT,
        stories: stories.map((r) => ({
          id: r.id,
          kind: r.kind,
          headline: r.headline,
          topics: r.topics,
          companies: refs(r.company_ids, map),
          tone: r.sentiment,
          date: r.story_date,
          link: r.link,
        })),
      };
    },

    async costs(months) {
      const at = now();
      const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - (months - 1), 1)).toISOString();
      const byMonth = new Map<string, CostMonth>();
      for (let i = 0; i < months; i++) {
        const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
        byMonth.set(month, { month, total: 0, byPurpose: {}, byModel: {} });
      }
      for (let from = 0; ; from += 1000) {
        const batch = await rows<{ model: string; purpose: string; cost_usd: number | string; at: string }>(
          client
            .from("ai_usage")
            .select("model, purpose, cost_usd, at")
            .eq("feature", "news")
            .gte("at", start)
            .order("id")
            .range(from, from + 999),
        );
        for (const r of batch) {
          const month = r.at.slice(0, 7);
          const m = byMonth.get(month);
          if (!m) continue;
          const cost = Number(r.cost_usd);
          m.total += cost;
          m.byPurpose[r.purpose] = (m.byPurpose[r.purpose] ?? 0) + cost;
          m.byModel[r.model] = (m.byModel[r.model] ?? 0) + cost;
        }
        if (batch.length < 1000) break;
      }
      return {
        cap: capUsd(process.env),
        capSpendThisMonth: cents(await newsCapSpend(client, at)),
        months: [...byMonth.values()]
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((m) => ({
            month: m.month,
            total: cents(m.total),
            byPurpose: Object.fromEntries(Object.entries(m.byPurpose).map(([k, v]) => [k, cents(v)])),
            byModel: Object.fromEntries(Object.entries(m.byModel).map(([k, v]) => [k, cents(v)])),
          })),
      };
    },
  };
}

/** The owner page's three cost figures from the connector's monthly summary; per issue is this month's extract cost over issues done this month. */
export function pageCosts(summary: CostSummary, doneThisMonth: number): Costs {
  const [thisMonth, lastMonth] = summary.months;
  const extract = thisMonth?.byPurpose.extract ?? 0;
  return {
    thisMonth: thisMonth?.total ?? 0,
    lastMonth: lastMonth?.total ?? 0,
    perIssue: doneThisMonth > 0 ? cents(extract / doneThisMonth) : null,
  };
}

/** Reads ai_usage and this month's done issues for the owner page; the service client, because the page has already checked the owner. */
export async function readPageCosts(client: SupabaseClient, now: Date): Promise<Costs> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const [summary, done] = await Promise.all([
    createNewsReader(client, () => now).costs(2),
    client.from("news_issues").select("id", { count: "exact", head: true }).eq("status", "done").gte("received_at", monthStart).lt("received_at", nextMonthStart),
  ]);
  if (done.error) throw new Error(done.error.message);
  return pageCosts(summary, done.count ?? 0);
}
