import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createNewsReader } from "@/lib/news/reader";

// Run with: NEWS_TEST_DB=1 NEWS_TEST_SUPABASE_URL=http://127.0.0.1:55321 NEWS_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Refuses to load unless the API URL is local, because test rows can never be deleted.
const enabled = Boolean(process.env.NEWS_TEST_DB);
const apiUrl = process.env.NEWS_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.NEWS_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("NEWS_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("news reader against local Supabase", () => {
  const client = enabled ? createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : (null as never);
  const ok = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  const reader = createNewsReader(client);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  async function seed() {
    const tag = randomUUID().slice(0, 8);
    const topic = `it-${tag}`;
    ok(await client.from("news_topics").insert({ slug: topic, name: `Topic ${tag}` }));
    const [verified, unverified] = ok(
      await client
        .from("news_companies")
        .insert([
          { name: `Verified ${tag} Corp`, norm_name: `verified ${tag}`, ticker: "ZZVT", ticker_verified: true },
          { name: `Guess ${tag} Inc`, norm_name: `guess ${tag}`, ticker: "ZZGS", ticker_verified: false },
        ])
        .select("id"),
    ) as { id: number }[];
    const [oldRun, newRun] = ok(
      await client
        .from("news_extraction_runs")
        .insert([
          { model: "claude-sonnet-5-5", prompt_version: "t", kind: "daily" },
          { model: "claude-sonnet-5-5", prompt_version: "t", kind: "rerun" },
        ])
        .select("id"),
    ) as { id: number }[];
    const issue = ok(
      await client
        .from("news_issues")
        .insert({ source_id: "rundown-ai", message_id: `it-${tag}`, subject: `Issue ${tag}`, clean_text: "synthetic text", current_run_id: newRun.id })
        .select("id")
        .single(),
    ) as { id: string };
    const cluster = ok(await client.from("news_clusters").insert({ first_date: day(-1) }).select("id").single()) as { id: number };
    const story = (run_id: number, over: Record<string, unknown>) => ({
      run_id,
      issue_id: issue.id,
      source_id: "rundown-ai",
      story_date: day(-1),
      headline: `Headline ${tag}`,
      kind: "news",
      sentiment: 1,
      topics: [topic],
      company_ids: [verified.id],
      ...over,
    });
    ok(
      await client.from("news_stories").insert([
        story(oldRun.id, { headline: `Stale ${tag}` }),
        story(newRun.id, { headline: `Current A ${tag}`, cluster_id: cluster.id, company_ids: [verified.id, unverified.id], sentiment: 2 }),
        story(newRun.id, { headline: `Current B ${tag}`, cluster_id: cluster.id, sentiment: 0 }),
        story(newRun.id, { headline: `Sponsor ${tag}`, kind: "sponsor" }),
      ]),
    );
    return { tag, topic, verified: verified.id, issue: issue.id };
  }

  it("searches only current-run news stories, with a ticker only when verified", async () => {
    const { tag, topic } = await seed();
    const hits = await reader.search({ topic, limit: 20 });
    expect(hits.map((h) => h.headline).sort()).toEqual([`Current A ${tag}`, `Current B ${tag}`]);
    const a = hits.find((h) => h.headline.startsWith("Current A"))!;
    expect(a.companies).toEqual(expect.arrayContaining([{ name: `Verified ${tag} Corp`, ticker: "ZZVT" }, { name: `Guess ${tag} Inc`, ticker: null }]));
    expect(a).toMatchObject({ tone: 2, source: "rundown-ai", sourceName: "The Rundown AI" });
    expect(await reader.search({ topic, ticker: "zzvt", text: "current a", limit: 20 })).toHaveLength(1);
    expect(await reader.search({ topic, company: `guess ${tag}`, limit: 20 })).toHaveLength(1);
    expect(await reader.search({ topic, company: "no such company", limit: 20 })).toEqual([]);
    expect(await reader.search({ topic, limit: 1 })).toHaveLength(1);
    expect(await reader.search({ topic, from: day(0), limit: 20 })).toEqual([]);
  });

  it("trend counts a cluster as one story and each row as a mention", async () => {
    const { topic } = await seed();
    const points = await reader.trend({ kind: "topic", key: topic, from: day(-10), to: day(0), by: "day" });
    expect(points).toEqual([{ bucket: day(-1), stories: 1, mentions: 2, tone: 1 }]);
    const byCompany = await reader.trend({ kind: "company", key: "ZZVT", from: day(-10), to: day(0), by: "month" });
    expect(byCompany.reduce((n, p) => n + p.mentions, 0)).toBeGreaterThanOrEqual(2);
  });

  it("movers reports more coverage for a topic that only appears in the recent window", async () => {
    const { topic } = await seed();
    const movers = await reader.movers({ days: 7, limit: 50 });
    expect(movers.find((m) => m.key === topic)).toMatchObject({ kind: "topic", recentStories: 1, previousStories: 0, coverage: "more" });
  });

  it("getIssue returns current-run stories and null for an unknown id", async () => {
    const { tag, issue } = await seed();
    const detail = await reader.getIssue(issue);
    expect(detail?.text).toBe("synthetic text");
    expect(detail?.stories.map((s) => s.headline).sort()).toEqual([`Current A ${tag}`, `Current B ${tag}`, `Sponsor ${tag}`]);
    expect(await reader.getIssue(randomUUID())).toBeNull();
  });

  it("costs lists this month by purpose with the cap", async () => {
    ok(await client.from("ai_usage").insert({ feature: "news", model: "claude-sonnet-5-5", purpose: "extract", cost_usd: 0.5 }));
    const costs = await reader.costs(2);
    expect(costs.cap).toBeGreaterThan(0);
    expect(costs.capSpendThisMonth).toBeGreaterThanOrEqual(0.5);
    expect(costs.months[0].byPurpose.extract).toBeGreaterThanOrEqual(0.5);
  });
});
