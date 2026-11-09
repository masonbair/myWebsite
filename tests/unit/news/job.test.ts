import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelCharge } from "@/lib/news/extract";
import { runNewsJob, type IssueWork, type NewsJobDeps, type NewsJobStore, type SharedWork, type StoryInsert } from "@/lib/news/job";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-11-09T15:00:00Z");
const MONTH = "2026-11";

type Row = { status: string; attempts: number; nextAttemptAt: string | null; lastError: string | null; runId: number | null; thin?: boolean; fetchedText?: string | null };

function fakeStore(opts: { spend?: number; issues?: IssueWork[]; shared?: SharedWork[]; silence?: { id: string; name: string; newestAt: string | null }[] } = {}) {
  const state = new Map<string, unknown>();
  const rows = new Map<string, Row>();
  const issues = new Map((opts.issues ?? []).map((i) => [i.id, i]));
  const shared = new Map((opts.shared ?? []).map((s) => [s.id, s]));
  for (const i of issues.values()) rows.set(i.id, { status: "pending", attempts: i.attempts, nextAttemptAt: null, lastError: null, runId: null });
  for (const s of shared.values()) rows.set(s.id, { status: "pending", attempts: s.attempts, nextAttemptAt: null, lastError: null, runId: null, fetchedText: s.fetchedText });
  const stories: (StoryInsert & { id: number; cluster: boolean })[] = [];
  const charges: { charge: ModelCharge; purpose: string; ref: { newsIssueId?: string; itemId?: string } }[] = [];
  const trends: [string, string][] = [];
  const clusterCalls: number[][] = [];
  let spend = opts.spend ?? 0;

  const store: NewsJobStore = {
    refreshSec: vi.fn(async () => {}),
    capSpend: async () => spend,
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => void state.set(key, value),
    claim: async (kind, limit) => {
      const pool = kind === "issue" ? [...issues.keys()] : [...shared.keys()];
      const picked = pool.filter((id) => rows.get(id)!.status === "pending" || (rows.get(id)!.status === "failed" && rows.get(id)!.attempts < 3)).slice(0, limit);
      for (const id of picked) rows.get(id)!.status = "processing";
      return picked;
    },
    loadIssue: async (id) => issues.get(id) ?? null,
    loadShared: async (id) => {
      const s = shared.get(id);
      return s ? { ...s, fetchedText: rows.get(id)!.fetchedText ?? null, attempts: rows.get(id)!.attempts } : null;
    },
    topics: async () => [{ slug: "chips", name: "Chips" }],
    dailyRun: async () => 7,
    hasStories: async (kind, id, runId) => stories.some((s) => (kind === "issue" ? s.issue_id : s.shared_id) === id && s.run_id === runId),
    recordCharge: async (charge, purpose, ref) => {
      charges.push({ charge, purpose, ref });
      spend += 1;
      return 1;
    },
    resolveCompanies: async (companies) => companies.map((_, i) => i + 1),
    insertStories: async (rs) =>
      rs.map((r) => {
        const s = { ...r, id: stories.length + 1, cluster: false };
        stories.push(s);
        return { id: s.id, storyDate: s.story_date };
      }),
    saveFetched: async (id, text) => void (rows.get(id)!.fetchedText = text),
    finish: async (kind, id, runId, extra) => {
      const r = rows.get(id)!;
      Object.assign(r, { status: "done", runId, lastError: null }, extra?.thin === undefined ? {} : { thin: extra.thin });
    },
    fail: async (kind, id, attempts, nextAttemptAt, error) => {
      Object.assign(rows.get(id)!, { status: "failed", attempts, nextAttemptAt, lastError: error });
    },
    release: async (kind, id) => void (rows.get(id)!.status = "pending"),
    unclustered: async () => [],
    cluster: async (ids) => void clusterCalls.push(ids),
    refreshTrends: async (from, to) => void trends.push([from, to]),
    failedRows: async () =>
      [...rows.entries()].filter(([, r]) => r.status === "failed").map(([id]) => ({ sourceName: issues.get(id)?.sourceName ?? "Shared", date: "2026-11-08", error: "x" })),
    sourceSilence: async () => opts.silence ?? [],
    fetchReadable: vi.fn(async () => null),
  };
  return { store, state, rows, stories, charges, trends, clusterCalls };
}

function issue(n: number, overrides: Partial<IssueWork> = {}): IssueWork {
  return {
    id: `issue-${n}`,
    sourceId: "morning-brew",
    sourceName: "Morning Brew",
    subject: `Subject ${n}`,
    storyDate: "2026-11-08",
    text: `Synthetic issue ${n}`,
    attempts: 0,
    ...overrides,
  };
}

const goodReply = {
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        stories: [
          { headline: "Chip maker grows", kind: "news", topics: ["chips"], suggested_topic: null, companies: [{ name: "Acme", ticker: null, exchange: null }], sentiment: 1, link: null },
          { headline: "Sponsored", kind: "sponsor", topics: ["chips"], suggested_topic: null, companies: [], sentiment: 0, link: null },
        ],
      }),
    },
  ],
  usage: { input_tokens: 1000, output_tokens: 200 },
};
const refusal = { model: "claude-sonnet-5-5", stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 0 } };

function stubClaude(reply: (n: number) => unknown = () => goodReply) {
  let n = 0;
  const create = vi.fn(async () => reply(n++));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

function deps(store: NewsJobStore, overrides: Partial<NewsJobDeps> = {}) {
  const fetched: { url: string; body: { topic: string; title: string; message: string } }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    fetched.push({ url, body: JSON.parse(init.body as string) });
    return new Response("{}");
  }) as unknown as typeof fetch;
  const d: NewsJobDeps = {
    client: {} as SupabaseClient,
    anthropic: stubClaude().client,
    model: "claude-sonnet-5-5",
    now: () => NOW,
    deadlineMs: 240_000,
    cap: 25,
    ntfyTopic: "topic-x",
    fetchFn,
    timeZone: "America/New_York",
    store,
    ...overrides,
  };
  return { d, fetched };
}

describe("runNewsJob cap", () => {
  it("pauses over the cap with no Claude call, and alerts once per month", async () => {
    const f = fakeStore({ spend: 25, issues: [issue(1)] });
    const claude = stubClaude();
    const { d, fetched } = deps(f.store, { anthropic: claude.client });
    const first = await runNewsJob(d);
    expect(first.paused).toBe(true);
    expect(claude.create).not.toHaveBeenCalled();
    expect(f.rows.get("issue-1")!.status).toBe("pending");
    expect(f.state.get("news:paused")).toBe(MONTH);
    expect(fetched.filter((x) => /paused/i.test(x.body.title))).toHaveLength(1);

    const second = await runNewsJob(d);
    expect(second.paused).toBe(true);
    expect(fetched.filter((x) => /paused/i.test(x.body.title))).toHaveLength(1);
  });

  it("clears the pause flag once spend is back under the cap", async () => {
    const f = fakeStore({ spend: 3 });
    f.state.set("news:paused", MONTH);
    const { d } = deps(f.store);
    expect((await runNewsJob(d)).paused).toBe(false);
    expect(f.state.get("news:paused")).toBe(false);
  });
});

describe("runNewsJob issues", () => {
  it("extracts, records each charge with its issue, stores stories, clusters and refreshes trends", async () => {
    const f = fakeStore({ issues: [issue(1), issue(2, { storyDate: "2026-11-06" })] });
    const { d } = deps(f.store);
    const result = await runNewsJob(d);
    expect(result.extracted).toEqual(["issue-1", "issue-2"]);
    expect(f.rows.get("issue-1")).toMatchObject({ status: "done", runId: 7 });
    expect(f.stories).toHaveLength(4);
    expect(f.stories[0]).toMatchObject({ run_id: 7, issue_id: "issue-1", shared_id: null, source_id: "morning-brew", story_date: "2026-11-08", kind: "news", company_ids: [1], topics: ["chips"] });
    expect(f.charges.map((c) => [c.purpose, c.ref.newsIssueId])).toEqual([["extract", "issue-1"], ["extract", "issue-2"]]);
    expect(f.clusterCalls).toEqual([[1, 2, 3, 4]]);
    expect(result.clustered).toBe(4);
    expect(f.trends).toEqual([["2026-11-06", "2026-11-08"], ["2026-11-06", "2026-11-08"]]);
  });

  it("an ExtractError marks the issue failed with attempts 1 and a 60-minute retry, and records the spend", async () => {
    const f = fakeStore({ issues: [issue(1)] });
    const { d } = deps(f.store, { anthropic: stubClaude(() => refusal).client });
    const result = await runNewsJob(d);
    expect(result.failed).toEqual(["issue-1"]);
    const row = f.rows.get("issue-1")!;
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(Date.parse(row.nextAttemptAt!) - NOW.getTime()).toBe(60 * 60_000);
    expect(row.lastError).toMatch(/refusal/);
    expect(f.charges).toHaveLength(1);
    expect(f.trends).toEqual([]);
  });

  it("the third failure stays failed and is not claimed again", async () => {
    const f = fakeStore({ issues: [issue(1, { attempts: 2 })] });
    f.rows.get("issue-1")!.attempts = 2;
    const { d } = deps(f.store, { anthropic: stubClaude(() => refusal).client });
    await runNewsJob(d);
    expect(f.rows.get("issue-1")).toMatchObject({ status: "failed", attempts: 3 });
    expect(Date.parse(f.rows.get("issue-1")!.nextAttemptAt!) - NOW.getTime()).toBe(240 * 60_000);
    expect(await f.store.claim("issue", 5)).toEqual([]);
  });

  it("stops starting new issues after the deadline and hands the rest back unfailed", async () => {
    const f = fakeStore({ issues: [issue(1), issue(2)] });
    let t = NOW.getTime();
    const claude = stubClaude(() => {
      t += 300_000;
      return goodReply;
    });
    const { d } = deps(f.store, { anthropic: claude.client, now: () => new Date(t) });
    const result = await runNewsJob(d);
    expect(result.extracted).toEqual(["issue-1"]);
    expect(result.failed).toEqual([]);
    expect(claude.create).toHaveBeenCalledTimes(1);
    expect(f.rows.get("issue-2")).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("does not call Claude again for an issue whose stories already landed under today's run", async () => {
    const f = fakeStore({ issues: [issue(1)] });
    f.stories.push({ run_id: 7, issue_id: "issue-1", shared_id: null, source_id: "morning-brew", story_date: "2026-11-08", headline: "h", kind: "news", sentiment: 0, topics: [], suggested_topic: null, company_ids: [], link: null, id: 1, cluster: false });
    const claude = stubClaude();
    const { d } = deps(f.store, { anthropic: claude.client });
    expect((await runNewsJob(d)).extracted).toEqual(["issue-1"]);
    expect(claude.create).not.toHaveBeenCalled();
    expect(f.stories).toHaveLength(1);
  });

  it("skips clustering when the dedupe would start over the cap, leaving it for the next run", async () => {
    const f = fakeStore({ spend: 24.5, issues: [issue(1)] });
    const { d } = deps(f.store);
    const result = await runNewsJob(d);
    expect(result.extracted).toEqual(["issue-1"]);
    expect(f.clusterCalls).toEqual([]);
    expect(result.clustered).toBe(0);
    expect(f.trends).toEqual([["2026-11-08", "2026-11-08"]]);
  });
});

describe("runNewsJob shared articles", () => {
  const share = (overrides: Partial<SharedWork> = {}): SharedWork => ({
    id: "shared-1",
    itemId: "item-1",
    url: "https://example.com/a",
    title: "Shared title",
    description: "Shared note https://example.com/a",
    fetchedText: null,
    storyDate: "2026-11-09",
    attempts: 0,
    ...overrides,
  });

  it("a shared row whose fetch fails ends done and thin, with source shared and purpose shared", async () => {
    const f = fakeStore({ shared: [share()] });
    const claude = stubClaude();
    const { d } = deps(f.store, { anthropic: claude.client });
    const result = await runNewsJob(d);
    expect(result.extracted).toEqual(["shared-1"]);
    expect(f.rows.get("shared-1")).toMatchObject({ status: "done", thin: true, runId: 7 });
    expect(f.stories.every((s) => s.source_id === "shared" && s.shared_id === "shared-1" && s.issue_id === null)).toBe(true);
    expect(f.charges.map((c) => [c.purpose, c.ref.itemId, c.ref.newsIssueId])).toEqual([["shared", "item-1", undefined]]);
    const sent = (claude.create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
    expect(sent).toContain("Shared title");
    expect(sent).toContain("Shared note");
  });

  it("keeps fetched text and is not thin when the page reads", async () => {
    const f = fakeStore({ shared: [share()] });
    (f.store.fetchReadable as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ text: "Full synthetic article", title: "Page" });
    const claude = stubClaude();
    const { d } = deps(f.store, { anthropic: claude.client });
    await runNewsJob(d);
    expect(f.rows.get("shared-1")).toMatchObject({ status: "done", thin: false, fetchedText: "Full synthetic article" });
    const sent = (claude.create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
    expect(sent).toContain("Full synthetic article");
  });

  it("reuses text fetched on an earlier try instead of fetching again", async () => {
    const f = fakeStore({ shared: [share({ fetchedText: "Saved text" })] });
    const { d } = deps(f.store);
    await runNewsJob(d);
    expect(f.store.fetchReadable).not.toHaveBeenCalled();
    expect(f.rows.get("shared-1")).toMatchObject({ status: "done", thin: false });
  });
});

describe("runNewsJob alerts", () => {
  const at = (iso: string) => () => new Date(iso);

  it("sends the failure report once a day after 13:00 local", async () => {
    const f = fakeStore({ issues: [issue(1)] });
    const { d, fetched } = deps(f.store, { anthropic: stubClaude(() => refusal).client, now: at("2026-11-09T19:00:00Z") });
    await runNewsJob(d);
    const reports = () => fetched.filter((x) => /failed/i.test(x.body.title));
    expect(reports()).toHaveLength(1);
    expect(reports()[0].body.topic).toBe("topic-x");
    expect(reports()[0].body.message).toContain("Morning Brew");
    expect(f.state.get("news:failure-report")).toBe("2026-11-09");
    await runNewsJob({ ...d, now: at("2026-11-09T22:00:00Z") });
    expect(reports()).toHaveLength(1);
  });

  it("sends no failure report before 13:00 local or when nothing failed", async () => {
    const early = fakeStore({ issues: [issue(1)] });
    const a = deps(early.store, { anthropic: stubClaude(() => refusal).client, now: at("2026-11-09T16:00:00Z") });
    await runNewsJob(a.d);
    expect(a.fetched).toHaveLength(0);

    const clean = fakeStore();
    const b = deps(clean.store, { now: at("2026-11-09T19:00:00Z") });
    await runNewsJob(b.d);
    expect(b.fetched).toHaveLength(0);
  });

  it("alerts once for a source quiet 4 days, not for one quiet 2 days or one that never sent", async () => {
    const f = fakeStore({
      silence: [
        { id: "morning-brew", name: "Morning Brew", newestAt: "2026-11-05T12:00:00Z" },
        { id: "tech-brew", name: "Tech Brew", newestAt: "2026-11-07T12:00:00Z" },
        { id: "mindstream", name: "Mindstream", newestAt: null },
      ],
    });
    const { d, fetched } = deps(f.store);
    const result = await runNewsJob(d);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].body.title).toContain("Morning Brew");
    expect(result.alerts).toEqual(["silent:morning-brew"]);
    await runNewsJob(d);
    expect(fetched).toHaveLength(1);
  });

  it("keeps going when ntfy is down and retries the alert next run", async () => {
    const f = fakeStore({ silence: [{ id: "morning-brew", name: "Morning Brew", newestAt: "2026-11-01T12:00:00Z" }] });
    const { d } = deps(f.store, { fetchFn: (async () => new Response("", { status: 500 })) as unknown as typeof fetch });
    const result = await runNewsJob(d);
    expect(result.alerts).toEqual([]);
    expect(f.state.get("news:silent:morning-brew")).toBeUndefined();
  });
});

describe("runNewsJob fix round 1", () => {
  const at = (iso: string) => () => new Date(iso);
  const quiet = [{ id: "morning-brew", name: "Morning Brew", newestAt: "2026-11-01T12:00:00Z" }];

  it("refreshes trends before clustering and still alerts when clustering throws", async () => {
    const f = fakeStore({ issues: [issue(1)], silence: quiet });
    const order: string[] = [];
    f.store.refreshTrends = async () => void order.push("trends");
    f.store.cluster = async () => {
      order.push("cluster");
      throw new Error("dedupe down");
    };
    const { d, fetched } = deps(f.store);
    const result = await runNewsJob(d);
    expect(order).toEqual(["trends", "cluster"]);
    expect(result.extracted).toEqual(["issue-1"]);
    expect(result.clustered).toBe(0);
    expect(fetched).toHaveLength(1);
  });

  it("clusters in chunks of 5, stops past the clustering deadline, and refreshes trends over what got clustered", async () => {
    const f = fakeStore({ issues: [issue(1)] });
    let t = NOW.getTime();
    const leftovers = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, storyDate: i < 5 ? "2026-11-03" : "2026-11-04" }));
    f.store.unclustered = async () => leftovers;
    const chunks: number[][] = [];
    f.store.cluster = async (ids) => {
      chunks.push(ids);
      t += 200_000;
    };
    const { d } = deps(f.store, { now: () => new Date(t), deadlineMs: 180_000 });
    const result = await runNewsJob(d);
    expect(chunks.map((c) => c.length)).toEqual([5, 5]);
    expect(result.clustered).toBe(10);
    expect(f.trends).toEqual([
      ["2026-11-08", "2026-11-08"],
      ["2026-11-03", "2026-11-08"],
    ]);
  });

  it("still sends daily alerts while paused", async () => {
    const f = fakeStore({ spend: 30, silence: quiet });
    const { d, fetched } = deps(f.store, { now: at("2026-11-09T19:00:00Z") });
    const result = await runNewsJob(d);
    expect(result.paused).toBe(true);
    expect(result.alerts).toEqual(["paused", "silent:morning-brew"]);
    expect(fetched).toHaveLength(2);
  });

  it("retries the paused alert next run when ntfy failed, while the page flag stays the month", async () => {
    const f = fakeStore({ spend: 30 });
    let up = false;
    const sent: string[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      if (!up) return new Response("", { status: 500 });
      sent.push(JSON.parse(init.body as string).title);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const { d } = deps(f.store, { fetchFn });
    expect((await runNewsJob(d)).alerts).toEqual([]);
    expect(f.state.get("news:paused")).toBe(MONTH);
    up = true;
    expect((await runNewsJob(d)).alerts).toEqual(["paused"]);
    expect((await runNewsJob(d)).alerts).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("fails an issue with no source for good at once", async () => {
    const f = fakeStore({ issues: [issue(1, { sourceId: null })] });
    const claude = stubClaude();
    const { d } = deps(f.store, { anthropic: claude.client });
    await runNewsJob(d);
    expect(f.rows.get("issue-1")).toMatchObject({ status: "failed", attempts: 3 });
    expect(f.rows.get("issue-1")!.lastError).toMatch(/no newsletter source/);
    expect(claude.create).not.toHaveBeenCalled();
  });

  it("does not fetch a shared page again when its stories already landed under today's run", async () => {
    const f = fakeStore({
      shared: [{ id: "shared-1", itemId: "item-1", url: "https://example.com/a", title: "T", description: "", fetchedText: null, storyDate: "2026-11-09", attempts: 0 }],
    });
    f.stories.push({ run_id: 7, issue_id: null, shared_id: "shared-1", source_id: "shared", story_date: "2026-11-09", headline: "h", kind: "news", sentiment: 0, topics: [], suggested_topic: null, company_ids: [], link: null, id: 1, cluster: false });
    const { d } = deps(f.store);
    await runNewsJob(d);
    expect(f.store.fetchReadable).not.toHaveBeenCalled();
    expect(f.rows.get("shared-1")).toMatchObject({ status: "done", thin: true });
  });

  it("hands back the rest of the claims when a store call throws mid-loop", async () => {
    const f = fakeStore({ issues: [issue(1), issue(2), issue(3)] });
    const finish = f.store.finish;
    f.store.fail = async () => {
      throw new Error("db down");
    };
    f.store.finish = async (kind, id, runId, extra) => {
      if (id === "issue-2") throw new Error("db down");
      return finish(kind, id, runId, extra);
    };
    const { d } = deps(f.store);
    await expect(runNewsJob(d)).rejects.toThrow("db down");
    expect(f.rows.get("issue-1")!.status).toBe("done");
    expect(f.rows.get("issue-2")!.status).toBe("pending");
    expect(f.rows.get("issue-3")!.status).toBe("pending");
  });
});
