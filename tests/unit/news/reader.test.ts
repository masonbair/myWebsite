import { describe, expect, it } from "vitest";
import { readNewsOverview } from "@/lib/news/reader";

type Rows = Record<string, Record<string, unknown>[]>;

function fakeClient(rows: Rows, failTable?: string) {
  return {
    from(table: string) {
      const q = {
        tests: [] as ((r: Record<string, unknown>) => boolean)[],
        max: Infinity,
        newestFirst: false,
        select: () => q,
        eq: (c: string, v: unknown) => (q.tests.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (q.tests.push((r) => r[c] !== v), q),
        is: (c: string, v: null) => (q.tests.push((r) => r[c] === v), q),
        order: () => ((q.newestFirst = true), q),
        limit: (n: number) => ((q.max = n), q),
        not: () => q,
        then: (resolve: (v: unknown) => void) => {
          if (table === failTable) return resolve({ data: null, error: { message: "boom" } });
          let data = (rows[table] ?? []).filter((r) => q.tests.every((t) => t(r)));
          if (q.newestFirst) data = [...data].sort((x, y) => String(y.received_at).localeCompare(String(x.received_at)));
          resolve({ data: data.slice(0, q.max), error: null });
        },
      };
      return q;
    },
  } as never;
}

const now = new Date("2026-11-09T12:00:00Z");
const issue = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${n}`,
  source_id: "rundown-ai",
  subject: `Issue ${n}`,
  from_address: "news@x.example",
  received_at: new Date(Date.UTC(2026, 10, 9, 10, 0, 60 - n)).toISOString(),
  status: "done",
  last_error: null,
  ...extra,
});

const rows: Rows = {
  news_sources: [
    { id: "rundown-ai", name: "The Rundown AI" },
    { id: "morning-brew", name: "Morning Brew" },
  ],
  news_issues: [
    ...Array.from({ length: 12 }, (_, i) => issue(i)),
    issue(50, { source_id: "morning-brew", status: "failed", last_error: "rate limited" }),
    issue(60, { source_id: null, status: "quarantined", subject: "Confirm forwarding", from_address: "mail-noreply@google.com" }),
  ],
  news_stories: [{ suggested_topic: "robots" }, { suggested_topic: "robots" }, { suggested_topic: "chips" }, { suggested_topic: null }],
};

describe("readNewsOverview", () => {
  it("groups issues by source, newest first, ten per source", async () => {
    const out = await readNewsOverview(fakeClient(rows), now);
    const rundown = out.issues.find((s) => s.sourceId === "rundown-ai");
    expect(rundown?.sourceName).toBe("The Rundown AI");
    expect(rundown?.issues).toHaveLength(10);
    const brew = out.issues.find((s) => s.sourceId === "morning-brew");
    expect(brew?.issues[0]).toMatchObject({ id: "id-50", status: "failed", lastError: "rate limited" });
  });

  it("keeps a slow source's older failed issue visible next to a busy source", async () => {
    const busy = Array.from({ length: 40 }, (_, i) => issue(100 + i, { source_id: "rundown-ai", received_at: new Date(Date.UTC(2026, 10, 9, 11, 0, i)).toISOString() }));
    const old = issue(900, { source_id: "morning-brew", status: "failed", last_error: "bad json", received_at: "2026-09-01T00:00:00Z" });
    const out = await readNewsOverview(fakeClient({ ...rows, news_issues: [...busy, old] }), now);
    expect(out.issues.find((s) => s.sourceId === "rundown-ai")?.issues).toHaveLength(10);
    expect(out.issues.find((s) => s.sourceId === "morning-brew")?.issues).toEqual([
      { id: "id-900", subject: "Issue 900", receivedAt: "2026-09-01T00:00:00Z", status: "failed", lastError: "bad json" },
    ]);
  });

  it("shows the error only for failed issues", async () => {
    const stale = issue(70, { status: "pending", last_error: "old error" });
    const out = await readNewsOverview(fakeClient({ ...rows, news_issues: [stale] }), now);
    expect(out.issues[0].issues[0]).toMatchObject({ status: "pending", lastError: null });
  });

  it("lists quarantined mail apart from the source groups", async () => {
    const out = await readNewsOverview(fakeClient(rows), now);
    expect(out.quarantined).toEqual([
      { id: "id-60", from: "mail-noreply@google.com", subject: "Confirm forwarding", receivedAt: rows.news_issues[13].received_at },
    ]);
    expect(out.issues.flatMap((s) => s.issues).map((i) => i.id)).not.toContain("id-60");
  });

  it("counts suggested topics, biggest first", async () => {
    const out = await readNewsOverview(fakeClient(rows), now);
    expect(out.suggestedTopics).toEqual([
      { topic: "robots", count: 2 },
      { topic: "chips", count: 1 },
    ]);
  });

  it("shows no costs and the cap when no cost reader is given", async () => {
    const out = await readNewsOverview(fakeClient(rows), now);
    expect(out).toMatchObject({ costThisMonth: null, costLastMonth: null, costPerIssue: null, cap: 25, paused: false });
  });

  it("uses the injected cost reader and pause reader", async () => {
    const out = await readNewsOverview(fakeClient(rows), now, {
      costs: async () => ({ thisMonth: 3.5, lastMonth: 2, perIssue: 0.04 }),
      pausedMonth: async () => "2026-11",
    });
    expect(out).toMatchObject({ costThisMonth: 3.5, costLastMonth: 2, costPerIssue: 0.04, paused: true });
  });

  it("is not paused for another month", async () => {
    const out = await readNewsOverview(fakeClient(rows), now, { pausedMonth: async () => "2026-10" });
    expect(out.paused).toBe(false);
  });

  it("keeps the page up when the cost reader fails", async () => {
    const out = await readNewsOverview(fakeClient(rows), now, {
      costs: async () => {
        throw new Error("no table");
      },
    });
    expect(out.costThisMonth).toBeNull();
  });

  it("throws when a read fails", async () => {
    await expect(readNewsOverview(fakeClient(rows, "news_issues"), now)).rejects.toThrow();
  });
});
