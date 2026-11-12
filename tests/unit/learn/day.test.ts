import { describe, expect, it } from "vitest";
import { dayPlan, learnDate, learnToday } from "@/lib/learn/day";

describe("learnDate", () => {
  it("reads the date in Mason's zone", () => {
    expect(learnDate(new Date("2026-11-13T04:30:00Z"), "America/Denver")).toBe("2026-11-12");
  });
});

describe("dayPlan", () => {
  it("always opens with explain-it-simply and rotates the second card", () => {
    expect(dayPlan("2026-11-12")).toEqual([
      { position: 1, topic: "explain-simply", type: "explain" },
      { position: 2, topic: "value", type: "scenario" },
    ]);
    expect(dayPlan("2026-11-13")[1]).toEqual({ position: 2, topic: "products", type: "scenario" });
    expect(dayPlan("2026-11-14")[1]).toEqual({ position: 2, topic: "communication", type: "voice" });
  });
});

describe("learnToday", () => {
  const now = new Date("2026-11-13T18:00:00Z");
  const local = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:57321", LEARN_E2E_TODAY: "2031-01-02" };

  it("uses the e2e override only on a local, non-production stack", () => {
    expect(learnToday(now, "UTC", local)).toBe("2031-01-02");
  });

  it("ignores the override in production", () => {
    expect(learnToday(now, "UTC", { ...local, NODE_ENV: "production" })).toBe("2026-11-13");
  });

  it("ignores the override against a remote Supabase", () => {
    expect(learnToday(now, "UTC", { ...local, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toBe("2026-11-13");
  });

  it("ignores a malformed override", () => {
    expect(learnToday(now, "UTC", { ...local, LEARN_E2E_TODAY: "tomorrow" })).toBe("2026-11-13");
  });
});
