export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

const clamp = (n: number, max: number) => Math.max(-max, Math.min(max, n));

/** Degrees a tile turns so the edge nearest the pointer dips away: `x` feeds rotateY, `y` rotateX. */
export function leanFor(rect: Rect, pointer: Point, maxDeg = 4): Point {
  const reach = rect.width;
  const outside =
    pointer.x < rect.left - reach ||
    pointer.x > rect.left + rect.width + reach ||
    pointer.y < rect.top - reach ||
    pointer.y > rect.top + rect.height + reach;
  if (outside) return { x: 0, y: 0 };
  const nx = (pointer.x - (rect.left + rect.width / 2)) / (rect.width / 2);
  const ny = (pointer.y - (rect.top + rect.height / 2)) / (rect.height / 2);
  // `|| 0` turns -0 into 0, so a centered pointer writes "0deg", not "-0deg".
  return { x: clamp(nx * maxDeg, maxDeg) || 0, y: clamp(-ny * maxDeg, maxDeg) || 0 };
}
