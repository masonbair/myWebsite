export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Lean = { rotate: number; dx: number; dy: number };

const NONE: Lean = { rotate: 0, dx: 0, dy: 0 };

/** A flat (2D) turn in degrees plus a small px nudge toward a pointer that is ON the tile; zero anywhere else. */
export function leanFor(rect: Rect, pointer: Point, maxDeg = 1.5, maxNudge = 3): Lean {
  const inside =
    pointer.x >= rect.left &&
    pointer.x <= rect.left + rect.width &&
    pointer.y >= rect.top &&
    pointer.y <= rect.top + rect.height;
  if (!inside) return NONE;
  const nx = (pointer.x - (rect.left + rect.width / 2)) / (rect.width / 2);
  const ny = (pointer.y - (rect.top + rect.height / 2)) / (rect.height / 2);
  // `|| 0` turns -0 into 0, so a centered pointer writes "0deg", not "-0deg".
  return { rotate: nx * maxDeg || 0, dx: nx * maxNudge || 0, dy: ny * maxNudge || 0 };
}
