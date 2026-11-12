import { describe, expect, it } from "vitest";
import { leanFor } from "@/lib/motion/lean";

const rect = { left: 100, top: 100, width: 200, height: 100 };

describe("leanFor", () => {
  it("pointer at center gives no lean", () => {
    expect(leanFor(rect, { x: 200, y: 150 })).toEqual({ rotate: 0, dx: 0, dy: 0 });
  });

  it("pointer at the right edge turns toward it by the max", () => {
    expect(leanFor(rect, { x: 300, y: 150 }).rotate).toBe(1.5);
  });

  it("pointer at the left edge turns the other way", () => {
    expect(leanFor(rect, { x: 100, y: 150 }).rotate).toBe(-1.5);
  });

  it("nudge points toward the pointer and stays small", () => {
    const lean = leanFor(rect, { x: 300, y: 200 });
    expect(lean.dx).toBe(3);
    expect(lean.dy).toBe(3);
  });

  it("pointer outside the tile gives no lean", () => {
    expect(leanFor(rect, { x: 301, y: 150 })).toEqual({ rotate: 0, dx: 0, dy: 0 });
    expect(leanFor(rect, { x: 200, y: 99 })).toEqual({ rotate: 0, dx: 0, dy: 0 });
  });
});
