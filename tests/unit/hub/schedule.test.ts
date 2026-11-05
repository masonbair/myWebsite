import { describe, expect, it } from "vitest";
import { buildDays, estimateOf, localDue, offsetMinutesAt, parsePlan, place, withEstimate, type Day } from "@/lib/hub/schedule";
import type { Item } from "@/lib/hub/types";

const TODAY = "2026-10-26";
const OFFSET = -360;
const plan = { estimates: [{ id: "1", minutes: 45, timeBound: false }], busy: [], away: [] };

function task(date: string | null, time: string | null = null, description = ""): Pick<Item, "description" | "due"> {
  return { description, due: date === null ? null : { date, time } };
}

const days = (a: Partial<Parameters<typeof buildDays>[0]> = {}) =>
  buildDays({ today: TODAY, offsetMinutes: OFFSET, tasks: [], busy: [], away: [], ...a });
const day = (all: Day[], date: string) => all.find((d) => d.date === date)!;

describe("parsePlan", () => {
  it("accepts a well-formed plan", () => {
    expect(parsePlan(plan)).toEqual(plan);
  });

  it.each([20, 0, 315])("rejects %i minutes", (minutes) => {
    expect(() => parsePlan({ ...plan, estimates: [{ id: "1", minutes, timeBound: false }] })).toThrow(/estimates\[0\]\.minutes/);
  });

  it("rejects a busy time without an offset", () => {
    expect(() => parsePlan({ ...plan, busy: [{ start: "2026-10-28T17:00:00", end: "2026-10-28T18:00:00Z" }] })).toThrow(
      /busy\[0\]\.start/,
    );
  });

  it("rejects a task listed twice", () => {
    expect(() => parsePlan({ ...plan, estimates: [...plan.estimates, ...plan.estimates] })).toThrow(/estimates\[1\]\.id/);
  });

  it("rejects an away day that isn't YYYY-MM-DD", () => {
    expect(() => parsePlan({ ...plan, away: ["Nov 5"] })).toThrow(/away\[0\]/);
  });
});

describe("estimate line", () => {
  it("replaces an existing estimate", () => {
    expect(withEstimate("a\nestimate: 30 min", 45)).toBe("a\nestimate: 45 min");
  });

  it("appends one when missing", () => {
    expect(withEstimate("a", 45)).toBe("a\nestimate: 45 min");
  });

  it("reads it back, or null", () => {
    expect(estimateOf("a\nestimate: 45 min")).toBe(45);
    expect(estimateOf("x")).toBeNull();
  });
});

describe("localDue", () => {
  it("reads a wall-clock time as minutes after midnight", () => {
    expect(localDue({ date: "2026-10-28", time: "17:00:00" })).toEqual({ date: "2026-10-28", time: 1020 });
    expect(localDue({ date: "2026-10-28", time: "17:00" })).toEqual({ date: "2026-10-28", time: 1020 });
  });

  it("reads an all-day date", () => {
    expect(localDue({ date: "2026-10-28", time: null })).toEqual({ date: "2026-10-28", time: null });
  });
});

describe("offsetMinutesAt", () => {
  it("follows daylight saving in the named zone", () => {
    expect(offsetMinutesAt("America/Denver", new Date("2026-10-26T12:00:00Z"))).toBe(-360);
    expect(offsetMinutesAt("America/Denver", new Date("2026-12-01T12:00:00Z"))).toBe(-420);
    expect(offsetMinutesAt("Asia/Kolkata", new Date("2026-12-01T12:00:00Z"))).toBe(330);
    expect(offsetMinutesAt("UTC", new Date("2026-12-01T12:00:00Z"))).toBe(0);
  });
});

describe("buildDays", () => {
  it("covers the 14 days after today", () => {
    const all = days();
    expect(all).toHaveLength(14);
    expect(all[0].date).toBe("2026-10-27");
    expect(all[13].date).toBe("2026-11-09");
  });

  it("converts a New York event to local time before clipping", () => {
    const all = days({ busy: [{ start: "2026-10-28T18:00:00-05:00", end: "2026-10-28T19:00:00-05:00" }] });
    expect(day(all, "2026-10-28")).toEqual({ date: "2026-10-28", load: 60, taken: [[1020, 1080]], away: false });
  });

  it("splits an event that crosses midnight across both days' windows", () => {
    const all = days({ busy: [{ start: "2026-10-28T20:00:00-06:00", end: "2026-10-29T17:00:00-06:00" }] });
    expect(day(all, "2026-10-28").load).toBe(60);
    expect(day(all, "2026-10-29").load).toBe(60);
  });

  it("counts overlapping events once", () => {
    const all = days({
      busy: [
        { start: "2026-10-28T17:00:00-06:00", end: "2026-10-28T18:00:00-06:00" },
        { start: "2026-10-28T17:30:00-06:00", end: "2026-10-28T18:30:00-06:00" },
      ],
    });
    expect(day(all, "2026-10-28").load).toBe(90);
  });

  it("counts all-day and in-window tasks, not morning ones", () => {
    const all = days({
      tasks: [
        task("2026-10-28", "10:00:00"),
        task("2026-10-29", null, "estimate: 45 min"),
        task("2026-10-30"),
        task("2026-11-01", "17:00:00", "estimate: 60 min"),
      ],
    });
    expect(day(all, "2026-10-28").load).toBe(0);
    expect(day(all, "2026-10-29").load).toBe(45);
    expect(day(all, "2026-10-30").load).toBe(30);
    expect(day(all, "2026-11-01")).toMatchObject({ load: 60, taken: [[1020, 1080]] });
  });

  it("marks away days", () => {
    const all = days({ away: ["2026-10-27"] });
    expect(all.map((d) => d.away).slice(0, 2)).toEqual([true, false]);
  });
});

describe("place", () => {
  const anytime = (minutes: number) => ({ id: "x", minutes, timeBound: false });
  const timed = (minutes: number) => ({ id: "x", minutes, timeBound: true });

  it("puts an anytime to-do all-day on the first day", () => {
    expect(place(days(), anytime(60))).toEqual({ date: "2026-10-27", time: null });
  });

  it("moves on once a day's budget is used", () => {
    const all = days();
    expect([60, 60, 60].map((m) => place(all, anytime(m)).date)).toEqual(["2026-10-27", "2026-10-27", "2026-10-28"]);
  });

  it("puts a time-bound to-do in the first free gap", () => {
    const all = days({ busy: [{ start: "2026-10-27T16:00:00-06:00", end: "2026-10-27T17:00:00-06:00" }] });
    expect(place(all, timed(60))).toEqual({ date: "2026-10-27", time: 1020 });
    expect(day(all, "2026-10-27").taken).toContainEqual([1020, 1080]);
  });

  it("goes on the lightest day when every day is full, earliest on ties", () => {
    const all = days();
    for (const d of all) d.load = 150;
    day(all, "2026-11-02").load = 140;
    expect(place(all, anytime(30)).date).toBe("2026-11-02");
    expect(place(all, anytime(30)).date).toBe("2026-10-27");
  });

  it("goes all-day on the lightest day when no day has a big enough gap", () => {
    const all = days();
    for (const d of all) d.taken = [[1020, 1260]];
    day(all, "2026-10-30").load = 10;
    for (const d of all) if (d.date !== "2026-10-30") d.load = 20;
    expect(place(all, timed(120))).toEqual({ date: "2026-10-30", time: null });
  });

  it("skips away days", () => {
    expect(place(days({ away: ["2026-10-27"] }), anytime(30)).date).toBe("2026-10-28");
  });

  it("uses tomorrow when every day is away", () => {
    const all = days({ away: days().map((d) => d.date) });
    expect(place(all, anytime(30))).toEqual({ date: "2026-10-27", time: null });
  });
});
