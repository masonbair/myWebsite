import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEADERBOARD_KEY, MAX_NAME, MAX_SCORE, RATE_LIMIT, loadScores, saveScore } from "@/lib/leaderboard";
import { hashIp, validateEntry } from "@/lib/leaderboard-server";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("local leaderboard", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-11-04T12:00:00Z") }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the old key and shape", () => {
    const old = [{ name: "SwiftCat12", score: 9, date: "2025-01-01T00:00:00.000Z" }];
    const storage = fakeStorage({ catGameLeaderboard: JSON.stringify(old) });
    vi.stubGlobal("localStorage", storage);
    expect(LEADERBOARD_KEY).toBe("catGameLeaderboard");
    expect(loadScores()).toEqual(old);

    saveScore("Tester", 12);
    expect(JSON.parse(storage.data.get("catGameLeaderboard")!)).toEqual([
      { name: "Tester", score: 12, date: "2026-11-04T12:00:00.000Z" },
      ...old,
    ]);
  });

  it("returns an empty list on bad JSON or no storage", () => {
    vi.stubGlobal("localStorage", fakeStorage({ catGameLeaderboard: "{nope" }));
    expect(loadScores()).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadScores()).toEqual([]);
  });

  it("drops malformed entries", () => {
    const rows = [{ name: "ok", score: 3, date: "x" }, { name: 5, score: "a" }, null];
    vi.stubGlobal("localStorage", fakeStorage({ catGameLeaderboard: JSON.stringify(rows) }));
    expect(loadScores()).toEqual([{ name: "ok", score: 3, date: "x" }]);
  });

  it("trims names to 20 chars and keeps the top 50", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `p${i}`, score: i + 100, date: "x" }));
    const storage = fakeStorage({ catGameLeaderboard: JSON.stringify(many) });
    vi.stubGlobal("localStorage", storage);
    const { entry, list } = saveScore("  a name that is far too long  ", 500);
    expect(list[0]).toBe(entry);
    expect(list).toHaveLength(50);
    expect(list[0]).toMatchObject({ name: "a name that is far t", score: 500 });
    expect(list.at(-1)!.score).toBe(111);
  });

  it("does not throw when saving is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(saveScore("Tester", 2).list).toEqual([{ name: "Tester", score: 2, date: "2026-11-04T12:00:00.000Z" }]);
  });
});

describe("validateEntry", () => {
  it.each([
    [{ name: "", score: 5 }, "bad_name"],
    [{ name: "   ", score: 5 }, "bad_name"],
    [{ name: "a".repeat(21), score: 5 }, "bad_name"],
    [{ name: 42, score: 5 }, "bad_name"],
    [{ name: "tab\there", score: 5 }, "bad_name"],
    [{ name: "rtl‮flip", score: 5 }, "bad_name"],
    [null, "bad_name"],
    [{ name: "ok", score: 0 }, "bad_score"],
    [{ name: "ok", score: 1001 }, "bad_score"],
    [{ name: "ok", score: 2.5 }, "bad_score"],
    [{ name: "ok", score: "5" }, "bad_score"],
    [{ name: "ok", score: 10_000_000 }, "bad_score"],
    [{ name: "fuck", score: 5 }, "offensive_name"],
    [{ name: "sh1t head", score: 5 }, "offensive_name"],
  ])("rejects %j as %s", (raw, error) => {
    expect(validateEntry(raw)).toEqual({ ok: false, error });
  });

  it("trims and collapses whitespace", () => {
    expect(validateEntry({ name: "  Mason   B ", score: 12 })).toEqual({ ok: true, entry: { name: "Mason B", score: 12 } });
  });

  it("keeps HTML as literal text", () => {
    expect(validateEntry({ name: "<b>hi</b>", score: 1 })).toEqual({ ok: true, entry: { name: "<b>hi</b>", score: 1 } });
  });

  it("accepts the max score and a 20 char name, and drops extra fields", () => {
    const name = "a".repeat(MAX_NAME);
    expect(validateEntry({ name, score: MAX_SCORE, ip_hash: "x" })).toEqual({ ok: true, entry: { name, score: 1000 } });
  });
});

describe("hashIp", () => {
  it("is a salted sha256 hex", () => {
    const h = hashIp("1.2.3.4", "salt");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("1.2.3.4", "salt")).toBe(h);
    expect(hashIp("1.2.3.4", "other")).not.toBe(h);
    expect(hashIp("1.2.3.5", "salt")).not.toBe(h);
  });
});

describe("constants", () => {
  it("match the brief", () => {
    expect(MAX_SCORE).toBe(1000);
    expect(RATE_LIMIT).toEqual({ max: 5, windowMinutes: 10 });
  });
});
