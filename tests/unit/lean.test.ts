import { describe, expect, it } from "vitest";
import { leanFor } from "@/lib/motion/lean";

const rect = { left: 100, top: 100, width: 200, height: 100 };

describe("leanFor", () => {
  it("pointer at center gives no lean", () => {
    expect(leanFor(rect, { x: 200, y: 150 })).toEqual({ x: 0, y: 0 });
  });

  it("pointer at right edge leans right by max", () => {
    expect(leanFor(rect, { x: 300, y: 150 }).x).toBe(4);
  });

  it("result is clamped", () => {
    const lean = leanFor(rect, { x: 480, y: 150 });
    expect(Math.abs(lean.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(lean.y)).toBeLessThanOrEqual(4);
  });

  it("far pointer gives no lean", () => {
    expect(leanFor(rect, { x: 2000, y: 150 })).toEqual({ x: 0, y: 0 });
  });

  it("pointer below the center tips the top edge back", () => {
    expect(leanFor(rect, { x: 200, y: 200 }).y).toBe(-4);
  });
});
