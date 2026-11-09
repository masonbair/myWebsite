import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicTrends, readSubject, type TrendStore } from "@/lib/news/public";

const raw = (extra: Record<string, unknown> = {}) => ({
  day: "2026-11-08",
  kind: "topic",
  key: "ai-chips",
  label: "AI chips",
  ticker: null,
  stories: 2,
  mentions: 3,
  tone_avg: "0.40",
  sources: ["morning-brew"],
  ...extra,
});

function store(over: Partial<TrendStore> = {}): TrendStore {
  return {
    today: "2026-11-09",
    trends: async () => [raw()],
    coverage: async () => [{ day: "2026-11-03", source_name: "Morning Brew", public_url: "https://www.morningbrew.com/issues/nov-3" }],
    inactiveTopics: async () => [],
    ...over,
  };
}

describe("readPublicTrends", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null when the database env is missing", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("TRENDS_FIXTURE", "");
    expect(await readPublicTrends()).toBeNull();
  });

  it("is null when the store fails", async () => {
    const failing = store({ trends: async () => Promise.reject(new Error("down")) });
    expect(await readPublicTrends({ store: failing })).toBeNull();
  });

  it("asks for the 35 days the movers need", async () => {
    const trends = vi.fn(async () => [raw()]);
    await readPublicTrends({ store: store({ trends }) });
    expect(trends).toHaveBeenCalledWith("2026-10-06", "2026-11-09");
  });

  it("keeps only the known fields of each row", async () => {
    const result = await readPublicTrends({ store: store({ trends: async () => [raw({ headline: "Secret words" })] }) });
    expect(result).toEqual({
      today: "2026-11-09",
      rows: [
        {
          day: "2026-11-08",
          kind: "topic",
          key: "ai-chips",
          label: "AI chips",
          ticker: null,
          stories: 2,
          mentions: 3,
          toneAvg: 0.4,
          sources: ["morning-brew"],
        },
      ],
    });
  });

  it("drops malformed rows and rows for inactive topics", async () => {
    const rows = [
      raw({ kind: "story" }),
      raw({ day: "yesterday" }),
      raw({ stories: -1 }),
      raw({ key: "../x" }),
      raw({ kind: "company", key: "abc" }),
      raw({ key: "retired" }),
      raw({ kind: "company", key: "42", label: "Nvidia", ticker: "NVDA" }),
    ];
    const result = await readPublicTrends({ store: store({ trends: async () => rows, inactiveTopics: async () => ["retired"] }) });
    expect(result?.rows.map((r) => `${r.kind}:${r.key}`)).toEqual(["company:42"]);
  });

  it("reads a named fixture outside production", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("TRENDS_FIXTURE", "trends.json");
    const result = await readPublicTrends();
    expect(result?.rows.length).toBeGreaterThan(0);
  });

  it("ignores fixture names that could escape the fixtures folder", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("TRENDS_FIXTURE", "../../../package.json");
    expect(await readPublicTrends()).toBeNull();
  });

  it("ignores the fixture in production", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("TRENDS_FIXTURE", "trends.json");
    vi.stubEnv("NODE_ENV", "production");
    expect(await readPublicTrends()).toBeNull();
  });
});

describe("readSubject", () => {
  it("asks for one subject over a year and returns its coverage", async () => {
    const trends = vi.fn(async () => [raw()]);
    const subject = await readSubject("topic", "ai-chips", { store: store({ trends }) });
    expect(trends).toHaveBeenCalledWith("2025-11-11", "2026-11-09", { kind: "topic", key: "ai-chips" });
    expect(subject).toMatchObject({
      kind: "topic",
      key: "ai-chips",
      label: "AI chips",
      coverage: [{ day: "2026-11-03", sourceName: "Morning Brew", publicUrl: "https://www.morningbrew.com/issues/nov-3" }],
    });
  });

  it("is null for an unknown kind or a key in the wrong shape", async () => {
    expect(await readSubject("story", "ai-chips", { store: store() })).toBeNull();
    expect(await readSubject("company", "ai-chips", { store: store() })).toBeNull();
  });

  it("is null when the subject has no rows or its topic is inactive", async () => {
    expect(await readSubject("topic", "ai-chips", { store: store({ trends: async () => [] }) })).toBeNull();
    expect(await readSubject("topic", "ai-chips", { store: store({ inactiveTopics: async () => ["ai-chips"] }) })).toBeNull();
  });

  it("drops coverage links that are not plain https addresses", async () => {
    const coverage = async () => [
      { day: "2026-11-03", source_name: "Morning Brew", public_url: "https://www.morningbrew.com/a?utm=1" },
      { day: "2026-11-03", source_name: "Morning Brew", public_url: "http://www.morningbrew.com/a" },
      { day: "2026-11-02", source_name: "Tech Brew", public_url: null },
      { day: "2026-11-01", source_name: "Tech Brew", public_url: "https://www.morningbrew.com/tech" },
    ];
    const subject = await readSubject("topic", "ai-chips", { store: store({ coverage }) });
    expect(subject?.coverage.map((c) => c.publicUrl)).toEqual(["https://www.morningbrew.com/tech"]);
  });
});
