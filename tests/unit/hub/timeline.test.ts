import { describe, expect, it } from "vitest";
import { isOpenDay } from "@/lib/hub/timeline";

describe("isOpenDay", () => {
  const now = new Date("2026-11-09T03:00:00Z");

  it("allows today, the two days before and tomorrow, so every time zone's today and yesterday fit", () => {
    for (const day of ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]) expect(isOpenDay(day, now)).toBe(true);
  });

  it("closes older days and days further ahead", () => {
    expect(isOpenDay("2026-11-06", now)).toBe(false);
    expect(isOpenDay("2026-11-11", now)).toBe(false);
  });
});
