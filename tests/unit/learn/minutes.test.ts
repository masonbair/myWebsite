import { describe, expect, it } from "vitest";
import { GRADE_MINUTES, grantMinutes } from "@/lib/learn/minutes";
import { DAILY_CAP_MINUTES, READING_MINUTES } from "@/lib/learn/types";

describe("GRADE_MINUTES", () => {
  it("maps every grade per the table", () => {
    expect(GRADE_MINUTES).toEqual({ A: 4, "A-": 4, "B+": 3, B: 3, "B-": 2, C: 1, D: 0, F: 0 });
  });

  it("lets two A answers and two accepted takeaways reach exactly the cap", () => {
    expect(GRADE_MINUTES.A * 2 + READING_MINUTES * 2).toBe(DAILY_CAP_MINUTES);
  });
});

describe("grantMinutes", () => {
  it("clamps to what is left under the daily cap", () => {
    expect(grantMinutes(4, 8)).toBe(2);
    expect(grantMinutes(4, 10)).toBe(0);
    expect(grantMinutes(1, 9)).toBe(1);
    expect(grantMinutes(4, 12)).toBe(0);
  });
});
