import { describe, expect, it } from "vitest";
import { dotPush } from "@/lib/motion/dots";

describe("dotPush", () => {
  it("no pointer, no push", () => {
    expect(dotPush({ x: 10, y: 10 }, null)).toEqual({ dx: 0, dy: 0 });
  });

  it("dot outside radius is still", () => {
    expect(dotPush({ x: 500, y: 0 }, { x: 0, y: 0 })).toEqual({ dx: 0, dy: 0 });
  });

  it("push points away from pointer", () => {
    const { dx, dy } = dotPush({ x: 60, y: 0 }, { x: 0, y: 0 });
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeCloseTo(0);
  });

  it("push never exceeds strength", () => {
    for (const x of [1, 5, 20, 60, 119]) {
      const { dx, dy } = dotPush({ x, y: 3 }, { x: 0, y: 0 });
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(10);
    }
  });

  it("dot exactly on the pointer is still", () => {
    expect(dotPush({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ dx: 0, dy: 0 });
  });
});
