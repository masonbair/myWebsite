import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { assignClusters } from "@/lib/news/dedupe";

// Run with: NEWS_TEST_DB=1 NEWS_TEST_SUPABASE_URL=http://127.0.0.1:55321 NEWS_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Refuses to load unless the API URL is local, because test rows can never be deleted.
const enabled = Boolean(process.env.NEWS_TEST_DB);
const apiUrl = process.env.NEWS_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.NEWS_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("NEWS_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

type NewStory = { headline: string; companyIds?: number[]; topics?: string[]; day?: number; kind?: string };

describe.skipIf(!enabled)("assignClusters against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Random dates, company ids and topics keep pools from earlier runs out of each test, since rows are never deleted.
  let month = 0;
  async function world() {
    month += 1;
    const year = 2040 + Math.floor(Math.random() * 50);
    const company = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const topic = `t-${randomUUID().slice(0, 8)}`;
    const day = (d: number) => `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const { data: run, error: runError } = await client()
      .from("news_extraction_runs")
      .insert({ model: "claude-sonnet-5-5", prompt_version: "test", kind: "daily" })
      .select("id")
      .single();
    if (runError || !run) throw runError;
    const runId: number = run.id;

    async function issue(stories: NewStory[], current = true): Promise<number[]> {
      const { data: row, error } = await client()
        .from("news_issues")
        .insert({ source_id: "morning-brew", message_id: `<${randomUUID()}@example.test>`, status: "done", current_run_id: current ? runId : null })
        .select("id")
        .single();
      if (error) throw error;
      const { data, error: storyError } = await client()
        .from("news_stories")
        .insert(
          stories.map((s) => ({
            run_id: runId,
            issue_id: row.id,
            source_id: "morning-brew",
            story_date: day(s.day ?? 10),
            headline: s.headline,
            kind: s.kind ?? "news",
            sentiment: 0,
            topics: s.topics ?? [topic],
            company_ids: s.companyIds ?? [],
          })),
        )
        .select("id");
      if (storyError) throw storyError;
      return data.map((d) => d.id);
    }
    return { issue, company };
  }

  async function clusterOf(ids: number[]): Promise<(number | null)[]> {
    const { data, error } = await client().from("news_stories").select("id, cluster_id").in("id", ids);
    if (error) throw error;
    const byId = new Map(data.map((r) => [r.id, r.cluster_id]));
    return ids.map((id) => byId.get(id) ?? null);
  }

  function stubHaiku(answers: boolean[]) {
    const create = vi.fn();
    for (const same of answers) {
      create.mockResolvedValueOnce({
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ same }) }],
        usage: { input_tokens: 90, output_tokens: 6 },
      });
    }
    return { anthropic: { beta: { messages: { create } } } as unknown as Anthropic, create };
  }

  async function dedupeRows(): Promise<number> {
    const { count, error } = await client()
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("feature", "news")
      .eq("purpose", "dedupe");
    if (error) throw error;
    return count ?? 0;
  }

  it("creates a cluster without calling the model when there are no candidates", async () => {
    const w = await world();
    const [a] = await w.issue([{ headline: "Lonely story about rare orchids" }]);
    const { anthropic, create } = stubHaiku([]);
    await assignClusters(client(), anthropic, [a]);
    expect(create).not.toHaveBeenCalled();
    expect((await clusterOf([a]))[0]).not.toBeNull();
  });

  it("joins a yes, starts a new cluster on a no, asks once per cluster, and records one dedupe row per call", async () => {
    const w = await world();
    const before = await dedupeRows();
    const [a] = await w.issue([{ headline: "Nvidia unveils new data center chip", companyIds: [w.company] }]);
    await assignClusters(client(), stubHaiku([]).anthropic, [a]);
    const [b] = await w.issue([{ headline: "Nvidia shows a new chip for data centers", companyIds: [w.company] }]);
    const second = stubHaiku([true]);
    await assignClusters(client(), second.anthropic, [b]);
    const [c] = await w.issue([{ headline: "Nvidia reports quarterly earnings", companyIds: [w.company] }]);
    const third = stubHaiku([false]);
    await assignClusters(client(), third.anthropic, [c]);

    const [ca, cb, cc] = await clusterOf([a, b, c]);
    expect(ca).not.toBeNull();
    expect(cb).toBe(ca);
    expect(cc).not.toBeNull();
    expect(cc).not.toBe(ca);
    expect(second.create).toHaveBeenCalledTimes(1);
    // a and b share a cluster, so one "no" covers both.
    expect(third.create).toHaveBeenCalledTimes(1);
    expect((await dedupeRows()) - before).toBe(2);
  });

  it("clusters stories from the same batch together and ignores old runs, other kinds and the same issue", async () => {
    const w = await world();
    const [a, sameIssue] = await w.issue([
      { headline: "Chipmaker merger announced", companyIds: [w.company] },
      { headline: "Chipmaker merger announced again", companyIds: [w.company] },
    ]);
    const [stale] = await w.issue([{ headline: "Chipmaker merger announced", companyIds: [w.company] }], false);
    const [sponsor] = await w.issue([{ headline: "Chipmaker merger announced", companyIds: [w.company], kind: "sponsor" }]);
    const [far] = await w.issue([{ headline: "Chipmaker merger announced", companyIds: [w.company], day: 20 }]);
    const [b] = await w.issue([{ headline: "Two chipmakers agree to merge", companyIds: [w.company] }]);

    const { anthropic, create } = stubHaiku([true]);
    await assignClusters(client(), anthropic, [a, b]);
    expect(create).toHaveBeenCalledTimes(1);
    const [ca, cb] = await clusterOf([a, b]);
    expect(ca).not.toBeNull();
    expect(cb).toBe(ca);
    expect(await clusterOf([sameIssue, stale, sponsor, far])).toEqual([null, null, null, null]);
  });

  it("keeps an event that spans days in its existing cluster when the new stories arrive together", async () => {
    const w = await world();
    const [c] = await w.issue([{ headline: "Chip export rules tightened", companyIds: [w.company], day: 9 }]);
    await assignClusters(client(), stubHaiku([]).anthropic, [c]);
    const [a] = await w.issue([{ headline: "Export rules on chips tightened", companyIds: [w.company] }]);
    const [b] = await w.issue([{ headline: "New limits on chip exports", companyIds: [w.company] }]);
    const { anthropic, create } = stubHaiku([true, true]);
    await assignClusters(client(), anthropic, [a, b]);
    const [ca, cb, cc] = await clusterOf([a, b, c]);
    expect(cc).not.toBeNull();
    expect([ca, cb]).toEqual([cc, cc]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats a failed call as not same and moves on", async () => {
    const w = await world();
    const [a] = await w.issue([{ headline: "Rate cut expected", companyIds: [w.company] }]);
    await assignClusters(client(), stubHaiku([]).anthropic, [a]);
    const [b] = await w.issue([{ headline: "Rate cut expected soon", companyIds: [w.company] }]);
    const create = vi.fn().mockRejectedValue(new Error("overloaded"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await assignClusters(client(), { beta: { messages: { create } } } as unknown as Anthropic, [b]);
    log.mockRestore();
    const [ca, cb] = await clusterOf([a, b]);
    expect(cb).not.toBeNull();
    expect(cb).not.toBe(ca);
  });
});
