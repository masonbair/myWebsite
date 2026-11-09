import { describe, expect, it } from "vitest";
import { moveText, movers, risingTopics, shortDate, topSubjects, toneWord, weeklySeries } from "@/lib/news/movers";
import type { TrendRow } from "@/lib/news/trend-data";

const TODAY = "2026-11-09";

function day(offset: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

const row = (offset: number, stories: number, extra: Partial<TrendRow> = {}): TrendRow => ({
  day: day(offset),
  kind: "topic",
  key: "ai-chips",
  label: "AI chips",
  ticker: null,
  stories,
  mentions: stories,
  toneAvg: 0,
  sources: ["morning-brew"],
  ...extra,
});

describe("movers", () => {
  it("never calls one story last week rising", () => {
    expect(movers([row(1, 1)], TODAY)).toEqual([]);
  });

  it("calls 6 stories against a weekly base of 2 rising", () => {
    const rows = [row(0, 3), row(3, 3), row(10, 4), row(20, 4)];
    const [m] = movers(rows, TODAY);
    expect(m).toMatchObject({ key: "ai-chips", direction: "rising", last7: 6, base: 2, change: 2 });
  });

  it("calls 0 stories against a weekly base of 4 falling", () => {
    const rows = [row(8, 4), row(15, 4), row(22, 4), row(29, 4)];
    const [m] = movers(rows, TODAY);
    expect(m).toMatchObject({ direction: "falling", last7: 0, base: 4, change: -1 });
  });

  it("ignores rows outside the 35 day window", () => {
    expect(movers([row(0, 6), row(35, 400)], TODAY)[0]).toMatchObject({ base: 0, direction: "rising" });
  });

  it("keeps topics and companies with the same key apart", () => {
    const rows = [row(0, 6), row(0, 1, { kind: "company", key: "ai-chips" })];
    expect(movers(rows, TODAY).map((m) => m.kind)).toEqual(["topic"]);
  });

  it("puts the biggest rise first", () => {
    const rows = [row(0, 4), row(0, 9, { key: "rates", label: "Rates" })];
    expect(movers(rows, TODAY).map((m) => m.key)).toEqual(["rates", "ai-chips"]);
  });
});

describe("toneWord", () => {
  it("names each band", () => {
    expect(toneWord(0.8)).toBe("mostly positive");
    expect(toneWord(0.5)).toBe("leaning positive");
    expect(toneWord(0)).toBe("mixed");
    expect(toneWord(-0.5)).toBe("leaning negative");
    expect(toneWord(-0.8)).toBe("mostly negative");
  });

  it("puts the cut points in the calmer band", () => {
    expect(toneWord(0.25)).toBe("mixed");
    expect(toneWord(-0.25)).toBe("mixed");
    expect(toneWord(0.75)).toBe("leaning positive");
    expect(toneWord(-0.75)).toBe("leaning negative");
  });
});

describe("topSubjects", () => {
  it("sums 30 days, weights tone by mentions and counts newsletters", () => {
    const rows = [
      row(0, 2, { mentions: 3, toneAvg: 1, sources: ["a", "b"] }),
      row(5, 1, { mentions: 1, toneAvg: -1, sources: ["b"] }),
      row(30, 50),
    ];
    const [s] = topSubjects(rows, TODAY, "topic");
    expect(s).toMatchObject({ key: "ai-chips", stories: 3, tone: 0.5, sources: 2 });
  });
});

describe("weeklySeries", () => {
  it("returns 52 weeks ending today with counts in the right week", () => {
    const weeks = weeklySeries([row(0, 2), row(6, 1), row(7, 5)], TODAY);
    expect(weeks).toHaveLength(52);
    expect(weeks.at(-1)).toMatchObject({ end: TODAY, stories: 3 });
    expect(weeks.at(-2)).toMatchObject({ stories: 5 });
    expect(weeks[0].stories).toBe(0);
    expect(weeks[0].tone).toBeNull();
  });
});

describe("moveText and shortDate", () => {
  it("says the change in counts", () => {
    expect(moveText({ direction: "rising", base: 2 })).toBe("up from 2 a week");
    expect(moveText({ direction: "falling", base: 4.25 })).toBe("down from 4.3 a week");
    expect(moveText({ direction: "rising", base: 0.5 })).toBe("up from under 1 a week");
    expect(moveText({ direction: "rising", base: 0 })).toBe("new this month");
  });

  it("formats a day as Mon D", () => {
    expect(shortDate("2026-11-03")).toBe("Nov 3");
  });
});

describe("risingTopics", () => {
  it("leaves out companies even when one rises fastest", () => {
    const rows = [
      row(0, 30, { kind: "company", key: "101", label: "Nvidia" }),
      row(0, 9, { key: "rates", label: "Rates" }),
      row(0, 4),
      row(8, 16, { key: "crypto", label: "Crypto" }),
    ];
    const all = movers(rows, TODAY);
    expect(all[0].key).toBe("101");
    expect(risingTopics(all, 5).map((m) => m.key)).toEqual(["rates", "ai-chips"]);
    expect(risingTopics(all, 1).map((m) => m.key)).toEqual(["rates"]);
  });
});
