import { describe, expect, it } from "vitest";
import { learnCapUsd } from "@/lib/learn/budget";

describe("learnCapUsd", () => {
  it("defaults to 10 and reads a positive LEARN_MONTHLY_BUDGET_USD", () => {
    expect(learnCapUsd({})).toBe(10);
    expect(learnCapUsd({ LEARN_MONTHLY_BUDGET_USD: "25" })).toBe(25);
    expect(learnCapUsd({ LEARN_MONTHLY_BUDGET_USD: "0" })).toBe(10);
    expect(learnCapUsd({ LEARN_MONTHLY_BUDGET_USD: "-3" })).toBe(10);
    expect(learnCapUsd({ LEARN_MONTHLY_BUDGET_USD: "abc" })).toBe(10);
  });
});
