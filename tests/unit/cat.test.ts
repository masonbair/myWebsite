import { describe, expect, it } from "vitest";
import { CAT_STAGE_LINES, catStage } from "@/lib/cat";

describe("catStage", () => {
  it("gains one stage every 2 points", () => {
    expect(catStage(0)).toBe(0);
    expect(catStage(3)).toBe(1);
    expect(catStage(20)).toBe(10);
  });

  it("caps at 10", () => {
    expect(catStage(999)).toBe(10);
  });

  it("is 0 for negatives", () => {
    expect(catStage(-4)).toBe(0);
  });
});

describe("CAT_STAGE_LINES", () => {
  it("has one line per stage", () => {
    expect(CAT_STAGE_LINES.length).toBe(11);
  });

  it("has no em or en dashes", () => {
    for (const line of CAT_STAGE_LINES) expect(line).not.toMatch(/[—–]/);
  });
});
