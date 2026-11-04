import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEADERBOARD_KEY, loadScores, saveScore } from "@/lib/leaderboard";

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
    const list = saveScore("  a name that is far too long  ", 500);
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
    expect(saveScore("Tester", 2)).toEqual([{ name: "Tester", score: 2, date: "2026-11-04T12:00:00.000Z" }]);
  });
});
