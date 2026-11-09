// Shared by the server reader and the pure trend math, so nothing here may import server-only code.

export type TrendKind = "topic" | "company";
export type TrendRow = {
  day: string;
  kind: TrendKind;
  key: string;
  label: string;
  ticker: string | null;
  stories: number;
  mentions: number;
  toneAvg: number;
  sources: string[];
};
export type Coverage = { day: string; sourceName: string; publicUrl: string };
export type PublicTrends = { today: string; rows: TrendRow[] };
export type Subject = { kind: TrendKind; key: string; label: string; ticker: string | null; today: string; rows: TrendRow[]; coverage: Coverage[] };

/** Days of rows the movers need: the last week plus the four before it. */
export const MOVER_DAYS = 35;
/** Days in the 52 weekly buckets a subject page charts. */
export const YEAR_DAYS = 52 * 7;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
