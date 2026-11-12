import { DAILY_CAP_MINUTES, type Grade } from "./types";

/** Minutes a grade earns; Claude never sets minutes, only this table does. */
export const GRADE_MINUTES: Record<Grade, number> = { A: 4, "A-": 4, "B+": 3, B: 3, "B-": 2, C: 1, D: 0, F: 0 };

/** What can still be granted today: `want`, cut to the room left under the daily cap. */
export function grantMinutes(want: number, grantedToday: number): number {
  return Math.max(0, Math.min(want, DAILY_CAP_MINUTES - grantedToday));
}
