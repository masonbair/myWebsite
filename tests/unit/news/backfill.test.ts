import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { UsageRow } from "@/lib/ai/claude";
import {
  collect,
  importMessages,
  reclean,
  runEstimate,
  type BackfillStore,
  type BatchState,
  type IssueForExtract,
  type StoryWrite,
} from "@/lib/news/backfill";
import type { IngestDeps } from "@/lib/news/ingest";
import type { NewIssue } from "@/lib/news/types";

const TOPICS = [{ slug: "chips", name: "Chips" }];

function issue(n: number, over: Partial<IssueForExtract> = {}): IssueForExtract {
  return {
    id: `issue-${n}`,
    sourceId: n % 2 ? "morning-brew" : "tech-brew",
    sourceName: n % 2 ? "Morning Brew" : "Tech Brew",
    subject: `Issue ${n}`,
    publishedOn: `2026-01-${String(n).padStart(2, "0")}`,
    cleanText: `Synthetic story text ${n}`,
    status: "backfill",
    currentRunId: null,
    ...over,
  };
}

type MemStory = StoryWrite & { id: number; runId: number; issueId: string };

function memoryStore(issues: IssueForExtract[]) {
  const state: { batches: BatchState | null; runs: { id: number; kind: string; model: string }[] } = { batches: null, runs: [] };
  const stories: MemStory[] = [];
  const usage: (UsageRow & { newsIssueId?: string | null })[] = [];
  const clustered: { ids: number[]; purpose: string }[] = [];
  const refreshed: [string, string][] = [];
  const byId = new Map(issues.map((i) => [i.id, i]));
  const store: BackfillStore = {
    async issues(scope) {
      if (scope.kind === "backfill") return issues.filter((i) => i.status === "backfill");
      return issues.filter((i) => i.status === "done" && i.publishedOn >= scope.from && i.publishedOn <= scope.to);
    },
    async issue(id) {
      return byId.get(id) ?? null;
    },
    async topics() {
      return TOPICS;
    },
    async getBatches() {
      return state.batches;
    },
    async setBatches(value) {
      state.batches = structuredClone(value);
    },
    async createRun(kind, model) {
      const id = state.runs.length + 100;
      state.runs.push({ id, kind, model });
      return id;
    },
    async storiesExist(issueId, runId) {
      return stories.some((s) => s.issueId === issueId && s.runId === runId);
    },
    async writeStories(runId, target, rows) {
      return rows.map((r) => {
        const id = stories.length + 1;
        stories.push({ ...r, id, runId, issueId: target.id });
        return id;
      });
    },
    async markDone(issueId, runId) {
      Object.assign(byId.get(issueId)!, { status: "done", currentRunId: runId });
    },
    async markFailed(issueId, error) {
      Object.assign(byId.get(issueId)!, { status: "failed", lastError: error });
    },
    async recordUsage(row) {
      usage.push(row);
    },
    async unclusteredStoryIds(runId) {
      return stories.filter((s) => s.runId === runId && s.kind === "news").map((s) => s.id);
    },
    async cluster(ids, purpose) {
      clustered.push({ ids, purpose });
    },
    async runDateRange(runId) {
      const dates = stories.filter((s) => s.runId === runId).map((s) => s.storyDate).sort();
      return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
    },
    async refreshTrends(from, to) {
      refreshed.push([from, to]);
    },
    async emptyCleanIssues() {
      return issues.filter((i) => i.cleanText === "" && i.rawPath).map((i) => ({ id: i.id, rawPath: i.rawPath! }));
    },
    async setCleanText(id, text) {
      byId.get(id)!.cleanText = text;
    },
  };
  return { store, state, stories, usage, clustered, refreshed, byId };
}

const reply = (headline: string) =>
  JSON.stringify({
    stories: [
      { headline, kind: "news", topics: ["chips"], suggested_topic: null, companies: [], sentiment: 1, link: null },
      { headline: "Ad", kind: "sponsor", topics: [], suggested_topic: null, companies: [], sentiment: 0, link: null },
    ],
  });

function succeeded(customId: string, headline: string) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded",
      message: {
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: reply(headline) }],
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
  };
}

function stubClient(opts: { results?: Record<string, unknown[]>; status?: string } = {}) {
  let created = 0;
  const calls = {
    countTokens: vi.fn(async () => ({ input_tokens: 8000 })),
    create: vi.fn<(params: { requests: { custom_id: string; params: Record<string, unknown> }[] }) => Promise<object>>(async () => ({
      id: `batch-${++created}`,
      processing_status: "in_progress",
    })),
    retrieve: vi.fn(async (id: string) => ({ id, processing_status: opts.status ?? "ended" })),
    results: vi.fn(async (id: string) => {
      const rows = opts.results?.[id] ?? [];
      return (async function* () {
        yield* rows;
      })();
    }),
  };
  const client = {
    beta: { messages: { countTokens: calls.countTokens, batches: { create: calls.create, retrieve: calls.retrieve, results: calls.results } } },
  } as unknown as Anthropic;
  return { client, calls };
}

const quiet = () => {};

describe("runEstimate", () => {
  it("prints the count, per-source counts and a batch-price estimate, and sends nothing on 'no'", async () => {
    const mem = memoryStore([1, 2, 3].map((n) => issue(n)));
    const { client, calls } = stubClient();
    const lines: string[] = [];
    const ask = vi.fn(async () => "no");
    const outcome = await runEstimate(mem.store, client, { scope: { kind: "backfill" }, model: "claude-sonnet-5-5", ask, log: (l) => lines.push(l) });

    expect(outcome).toBe("cancelled");
    expect(ask).toHaveBeenCalledWith("Type yes to submit: ");
    expect(calls.countTokens).toHaveBeenCalledTimes(3);
    expect(calls.create).not.toHaveBeenCalled();
    expect(mem.state.batches).toBeNull();
    const out = lines.join("\n");
    expect(out).toContain("3 issues");
    expect(out).toContain("Morning Brew: 2");
    expect(out).toContain("Tech Brew: 1");
    expect(out).toContain("2,500 output tokens per issue");
    // 3 x 8,000 input at $2/M plus 3 x 2,500 output at $10/M, halved for batch.
    expect(out).toContain("$0.06");
  });

  it("samples at most 10 issues for the token count", async () => {
    const mem = memoryStore(Array.from({ length: 25 }, (_, n) => issue(n + 1)));
    const { client, calls } = stubClient();
    await runEstimate(mem.store, client, { scope: { kind: "backfill" }, model: "claude-sonnet-5-5", ask: async () => "nope", log: quiet });
    expect(calls.countTokens).toHaveBeenCalledTimes(10);
    const params = (calls.countTokens.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty("max_tokens");
  });

  it("on 'yes' sends batches keyed by issue id without fallbacks and stores the batch ids", async () => {
    const mem = memoryStore([1, 2].map((n) => issue(n)));
    const { client, calls } = stubClient();
    const outcome = await runEstimate(mem.store, client, { scope: { kind: "backfill" }, model: "claude-sonnet-5-5", ask: async () => "yes\n", log: quiet });

    expect(outcome).toBe("sent");
    const requests = calls.create.mock.calls[0][0].requests;
    expect(requests.map((r) => r.custom_id)).toEqual(["issue-1", "issue-2"]);
    for (const r of requests) {
      expect(r.params).not.toHaveProperty("fallbacks");
      expect(r.params).not.toHaveProperty("betas");
    }
    expect(mem.state.batches?.submissions).toEqual([
      expect.objectContaining({ kind: "backfill", model: "claude-sonnet-5-5", batchIds: ["batch-1"], collected: [], runId: null }),
    ]);
  });

  it("splits more than 10,000 issues into several batches", async () => {
    const mem = memoryStore(Array.from({ length: 10_001 }, (_, n) => issue(n + 1, { cleanText: "x" })));
    const { client, calls } = stubClient();
    await runEstimate(mem.store, client, { scope: { kind: "backfill" }, model: "claude-haiku-5-5", ask: async () => "yes", log: quiet });
    expect(calls.create.mock.calls.map((c) => c[0].requests.length)).toEqual([10_000, 1]);
  });

  it("refuses to send while an earlier submission is not collected", async () => {
    const mem = memoryStore([issue(1)]);
    mem.state.batches = {
      submissions: [{ kind: "backfill", model: "claude-sonnet-5-5", promptVersion: "v1", batchIds: ["b"], collected: [], runId: null, submittedAt: "x" }],
    };
    const { client, calls } = stubClient();
    await expect(
      runEstimate(mem.store, client, { scope: { kind: "backfill" }, model: "claude-sonnet-5-5", ask: async () => "yes", log: quiet }),
    ).rejects.toThrow(/collect/);
    expect(calls.create).not.toHaveBeenCalled();
  });
});

describe("collect", () => {
  function submitted(mem: ReturnType<typeof memoryStore>, kind: "backfill" | "rerun", batchIds: string[]) {
    mem.state.batches = {
      submissions: [{ kind, model: "claude-sonnet-5-5", promptVersion: "v1", batchIds, collected: [], runId: null, submittedAt: "x" }],
    };
  }

  it("maps results by custom_id whatever their order, records batch usage, and moves issues to done", async () => {
    const mem = memoryStore([1, 2, 3].map((n) => issue(n)));
    submitted(mem, "backfill", ["batch-1"]);
    const { client } = stubClient({
      results: { "batch-1": [succeeded("issue-3", "Three"), succeeded("issue-1", "One"), succeeded("issue-2", "Two")] },
    });
    const summary = await collect(mem.store, client, { log: quiet });

    expect(summary).toMatchObject({ done: 3, failed: 0, pending: 0 });
    const news = mem.stories.filter((s) => s.kind === "news");
    expect(news.map((s) => [s.issueId, s.headline, s.storyDate])).toEqual([
      ["issue-3", "Three", "2026-01-03"],
      ["issue-1", "One", "2026-01-01"],
      ["issue-2", "Two", "2026-01-02"],
    ]);
    expect([...mem.byId.values()].every((i) => i.status === "done" && i.currentRunId === 100)).toBe(true);
    expect(mem.state.runs).toEqual([{ id: 100, kind: "backfill", model: "claude-sonnet-5-5" }]);
    expect(mem.usage).toHaveLength(3);
    expect(mem.usage[0]).toMatchObject({ feature: "news", purpose: "backfill", batch: true, model: "claude-sonnet-5-5", newsIssueId: "issue-3" });
    expect(mem.clustered).toEqual([{ ids: news.map((s) => s.id), purpose: "backfill" }]);
    expect(mem.refreshed).toEqual([["2026-01-01", "2026-01-03"]]);
    expect(mem.state.batches?.submissions[0]).toMatchObject({ collected: ["batch-1"], runId: 100 });
  });

  it("is idempotent: collecting again adds no stories or usage", async () => {
    const mem = memoryStore([1, 2].map((n) => issue(n)));
    submitted(mem, "backfill", ["batch-1"]);
    const { client } = stubClient({ results: { "batch-1": [succeeded("issue-1", "One"), succeeded("issue-2", "Two")] } });
    await collect(mem.store, client, { log: quiet });
    // Simulate a crash before the batch was marked collected.
    mem.state.batches!.submissions[0].collected = [];
    await collect(mem.store, client, { log: quiet });
    expect(mem.stories).toHaveLength(4);
    expect(mem.usage).toHaveLength(2);
    expect(mem.state.runs).toHaveLength(1);
  });

  it("only processes ended batches", async () => {
    const mem = memoryStore([issue(1)]);
    submitted(mem, "backfill", ["batch-1"]);
    const { client, calls } = stubClient({ status: "in_progress" });
    const summary = await collect(mem.store, client, { log: quiet });
    expect(summary.pending).toBe(1);
    expect(calls.results).not.toHaveBeenCalled();
    expect(mem.stories).toHaveLength(0);
  });

  it("moves errored and unreadable results to failed for the daily job", async () => {
    const mem = memoryStore([1, 2].map((n) => issue(n)));
    submitted(mem, "backfill", ["batch-1"]);
    const bad = succeeded("issue-2", "x");
    (bad.result.message.content[0] as { text: string }).text = "not json";
    const { client } = stubClient({
      results: { "batch-1": [{ custom_id: "issue-1", result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "busy" } } } }, bad] },
    });
    const summary = await collect(mem.store, client, { log: quiet });
    expect(summary).toMatchObject({ done: 0, failed: 2 });
    expect(mem.byId.get("issue-1")!.status).toBe("failed");
    expect(mem.byId.get("issue-2")!.status).toBe("failed");
    // The unreadable reply was still paid for.
    expect(mem.usage).toHaveLength(1);
  });

  it("a re-run writes new rows under a new run and leaves the old rows in place", async () => {
    const mem = memoryStore([issue(1, { status: "done", currentRunId: 7 })]);
    await mem.store.writeStories(7, mem.byId.get("issue-1")!, [
      { sourceId: "morning-brew", storyDate: "2026-01-01", headline: "Old", kind: "news", sentiment: 0, topics: [], suggestedTopic: null, companies: [], link: null },
    ]);
    submitted(mem, "rerun", ["batch-1"]);
    const { client } = stubClient({ results: { "batch-1": [succeeded("issue-1", "New")] } });
    await collect(mem.store, client, { log: quiet });

    expect(mem.stories.map((s) => [s.runId, s.headline])).toEqual([
      [7, "Old"],
      [100, "New"],
      [100, "Ad"],
    ]);
    expect(mem.byId.get("issue-1")).toMatchObject({ status: "done", currentRunId: 100 });
    expect(mem.usage[0]).toMatchObject({ purpose: "rerun", batch: true });
    expect(mem.clustered[0].purpose).toBe("rerun");
  });

  it("a failed re-run result leaves the issue on its old run", async () => {
    const mem = memoryStore([issue(1, { status: "done", currentRunId: 7 })]);
    submitted(mem, "rerun", ["batch-1"]);
    const { client } = stubClient({ results: { "batch-1": [{ custom_id: "issue-1", result: { type: "expired" } }] } });
    await collect(mem.store, client, { log: quiet });
    expect(mem.byId.get("issue-1")).toMatchObject({ status: "done", currentRunId: 7 });
  });
});

function rawEmail(n: number, from: string, date: string): Uint8Array {
  return new TextEncoder().encode(
    [
      `From: Brew <${from}>`,
      `To: reader@example.test`,
      `Subject: Synthetic issue ${n}`,
      `Date: ${date}`,
      `Message-ID: <synthetic-${n}@example.test>`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      `Synthetic newsletter body ${n}.`,
      "",
    ].join("\r\n"),
  );
}

function memoryIngest(): IngestDeps & { rows: NewIssue[] } {
  const rows: NewIssue[] = [];
  return {
    rows,
    async sources() {
      return [
        { id: "morning-brew", name: "Morning Brew", senderAddresses: ["crew@morningbrew.test"], senderDomains: [], homepage: null, archivePattern: null, public: true, active: true },
      ];
    },
    async putRaw() {},
    async insertIssue(row) {
      if (rows.some((r) => r.messageId === row.messageId)) return null;
      rows.push(row);
      return { id: `id-${rows.length}` };
    },
    async findIssueId(messageId) {
      const at = rows.findIndex((r) => r.messageId === messageId);
      return at >= 0 ? `id-${at + 1}` : null;
    },
    timeZone: "America/New_York",
  };
}

async function* messages(list: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* list;
}

describe("importMessages", () => {
  const mail = () => [
    rawEmail(1, "crew@morningbrew.test", "Mon, 05 Jan 2026 10:00:00 +0000"),
    rawEmail(2, "crew@morningbrew.test", "Tue, 06 Jan 2026 10:00:00 +0000"),
    rawEmail(3, "someone@unknown.test", "Tue, 06 Jan 2026 11:00:00 +0000"),
    rawEmail(4, "crew@morningbrew.test", "Mon, 01 Dec 2025 10:00:00 +0000"),
  ];

  it("counts per source, quarantined and too-old mail; a second import reports all duplicates", async () => {
    const deps = memoryIngest();
    const first = await importMessages(messages(mail()), deps, { since: "2026-01-01", log: quiet });
    expect(first).toEqual({ bySource: { "Morning Brew": 2 }, created: 3, duplicates: 0, quarantined: 1, older: 1, errors: 0 });
    expect(deps.rows.map((r) => r.status)).toEqual(["backfill", "backfill", "quarantined"]);

    const second = await importMessages(messages(mail()), deps, { since: "2026-01-01", log: quiet });
    expect(second).toEqual({ bySource: {}, created: 0, duplicates: 3, quarantined: 0, older: 1, errors: 0 });
    expect(deps.rows).toHaveLength(3);
  });
});

describe("reclean", () => {
  it("fills empty clean_text from the stored raw email", async () => {
    const mem = memoryStore([issue(1, { cleanText: "", rawPath: "news/raw/a.eml" }), issue(2, { cleanText: "", rawPath: "news/raw/missing.eml" })]);
    const raws: Record<string, Uint8Array> = { "news/raw/a.eml": rawEmail(1, "crew@morningbrew.test", "Mon, 05 Jan 2026 10:00:00 +0000") };
    const summary = await reclean(mem.store, async (path) => raws[path] ?? null, { log: quiet });
    expect(summary).toEqual({ fixed: 1, missing: 1, empty: 0 });
    expect(mem.byId.get("issue-1")!.cleanText).toContain("Synthetic newsletter body 1.");
    expect(mem.byId.get("issue-2")!.cleanText).toBe("");
  });
});
