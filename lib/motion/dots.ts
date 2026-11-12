import type { Point } from "./lean";

/** How far a background dot moves away from the pointer, in pixels; fades to nothing at `radius`. */
export function dotPush(dot: Point, pointer: Point | null, radius = 120, strength = 10): { dx: number; dy: number } {
  if (!pointer) return { dx: 0, dy: 0 };
  const x = dot.x - pointer.x;
  const y = dot.y - pointer.y;
  const distance = Math.hypot(x, y);
  if (distance === 0 || distance >= radius) return { dx: 0, dy: 0 };
  const falloff = 1 - distance / radius;
  const push = strength * falloff * falloff;
  return { dx: (x / distance) * push, dy: (y / distance) * push };
}
