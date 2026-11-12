import { describe, expect, it } from "vitest";
import { offsetMinutesAt } from "@/lib/hub/schedule";
import { sunPhase } from "@/lib/motion/sun";

const utc = (hhmm: string) => new Date(`2026-11-12T${hhmm}:00Z`);

describe("offsetMinutesAt", () => {
  it("offset for Lisbon in winter is 0", () => {
    expect(offsetMinutesAt("Europe/Lisbon", utc("12:00"))).toBe(0);
  });

  it("offset for New York in winter is -300", () => {
    expect(offsetMinutesAt("America/New_York", utc("12:00"))).toBe(-300);
  });
});

describe("sunPhase", () => {
  it("06:30 local is dawn", () => {
    expect(sunPhase(-300, utc("11:30"))).toBe("dawn");
  });

  it("12:00 local is day", () => {
    expect(sunPhase(0, utc("12:00"))).toBe("day");
  });

  it("18:00 local is dusk", () => {
    expect(sunPhase(60, utc("17:00"))).toBe("dusk");
  });

  it("23:00 local is night", () => {
    expect(sunPhase(-300, utc("04:00"))).toBe("night");
  });

  it("boundary 08:00 is day", () => {
    expect(sunPhase(0, utc("08:00"))).toBe("day");
  });

  it("offset that crosses midnight wraps the hour", () => {
    expect(sunPhase(330, utc("23:45"))).toBe("dawn");
  });
});
