import { describe, expect, it } from "vitest";
import { capUsd } from "@/lib/news/budget";

describe("capUsd", () => {
  it("defaults to 25", () => {
    expect(capUsd({})).toBe(25);
  });
  it("reads a positive number", () => {
    expect(capUsd({ NEWS_MONTHLY_BUDGET_USD: "40" })).toBe(40);
    expect(capUsd({ NEWS_MONTHLY_BUDGET_USD: "12.5" })).toBe(12.5);
  });
  it("ignores anything that is not a positive number", () => {
    for (const bad of ["", "abc", "0", "-5", "NaN", "Infinity", "10usd"]) {
      expect(capUsd({ NEWS_MONTHLY_BUDGET_USD: bad })).toBe(25);
    }
  });
});
