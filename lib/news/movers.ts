import { addDays, MOVER_DAYS, YEAR_DAYS, type TrendKind, type TrendRow } from "@/lib/news/public";

export type Direction = "rising" | "falling";
export type Mover = { kind: TrendKind; key: string; label: string; direction: Direction; last7: number; base: number; change: number };
export type SubjectSummary = {
  kind: TrendKind;
  key: string;
  label: string;
  ticker: string | null;
  stories: number;
  tone: number;
  sources: number;
};
export type Week = { end: string; stories: number; tone: number | null };
export type ToneWord = "mostly negative" | "leaning negative" | "mixed" | "leaning positive" | "mostly positive";

const id = (r: { kind: TrendKind; key: string }) => `${r.kind}:${r.key}`;

/** Topics and companies whose last 7 days stand out against the weekly average of the 28 days before. */
export function movers(rows: TrendRow[], today: string): Mover[] {
  const weekStart = addDays(today, -6);
  const baseStart = addDays(today, -(MOVER_DAYS - 1));
  const tally = new Map<string, { row: TrendRow; last7: number; before: number }>();
  for (const r of rows) {
    if (r.day < baseStart || r.day > today) continue;
    const t = tally.get(id(r)) ?? { row: r, last7: 0, before: 0 };
    if (r.day >= weekStart) t.last7 += r.stories;
    else t.before += r.stories;
    tally.set(id(r), t);
  }
  const out: Mover[] = [];
  for (const { row, last7, before } of tally.values()) {
    const base = before / 4;
    // Three stories is the floor so a single story never reads as a spike.
    const direction: Direction | null =
      last7 >= 3 && last7 >= 1.5 * base + 1 ? "rising" : base >= 3 && last7 <= 0.5 * base ? "falling" : null;
    if (direction) out.push({ kind: row.kind, key: row.key, label: row.label, direction, last7, base, change: (last7 - base) / Math.max(base, 1) });
  }
  return out.sort((a, b) => b.change - a.change);
}

/** Average tone (-1 to 1) as a plain word; a cut point belongs to the calmer side. */
export function toneWord(avg: number): ToneWord {
  if (avg < -0.75) return "mostly negative";
  if (avg < -0.25) return "leaning negative";
  if (avg <= 0.25) return "mixed";
  if (avg <= 0.75) return "leaning positive";
  return "mostly positive";
}

/** Each topic or company of one kind over the last 30 days, most stories first. */
export function topSubjects(rows: TrendRow[], today: string, kind: TrendKind, days = 30): SubjectSummary[] {
  const start = addDays(today, -(days - 1));
  const tally = new Map<string, { row: TrendRow; stories: number; toneSum: number; mentions: number; sources: Set<string> }>();
  for (const r of rows) {
    if (r.kind !== kind || r.day < start || r.day > today) continue;
    const t = tally.get(r.key) ?? { row: r, stories: 0, toneSum: 0, mentions: 0, sources: new Set<string>() };
    t.row = r.day >= t.row.day ? r : t.row;
    t.stories += r.stories;
    t.toneSum += r.toneAvg * r.mentions;
    t.mentions += r.mentions;
    r.sources.forEach((s) => t.sources.add(s));
    tally.set(r.key, t);
  }
  return [...tally.values()]
    .map(({ row, stories, toneSum, mentions, sources }) => ({
      kind,
      key: row.key,
      label: row.label,
      ticker: row.ticker,
      stories,
      tone: mentions > 0 ? toneSum / mentions : 0,
      sources: sources.size,
    }))
    .sort((a, b) => b.stories - a.stories || a.label.localeCompare(b.label));
}

/** 52 weeks ending today, oldest first, with stories and mention-weighted tone (null for a quiet week). */
export function weeklySeries(rows: TrendRow[], today: string): Week[] {
  const weeks = Array.from({ length: YEAR_DAYS / 7 }, (_, i) => ({
    end: addDays(today, -7 * (YEAR_DAYS / 7 - 1 - i)),
    stories: 0,
    toneSum: 0,
    mentions: 0,
  }));
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  for (const r of rows) {
    const back = Math.round((todayMs - Date.parse(`${r.day}T00:00:00Z`)) / 86_400_000);
    if (back < 0 || back >= YEAR_DAYS) continue;
    const w = weeks[weeks.length - 1 - Math.floor(back / 7)];
    w.stories += r.stories;
    w.toneSum += r.toneAvg * r.mentions;
    w.mentions += r.mentions;
  }
  return weeks.map(({ end, stories, toneSum, mentions }) => ({ end, stories, tone: mentions > 0 ? toneSum / mentions : null }));
}

/** "Nov 3" for a YYYY-MM-DD day, read as a calendar date with no time zone shift. */
export function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** How a mover changed, in counts a reader can check: "up from 2 a week". */
export function moveText(m: Pick<Mover, "direction" | "base">): string {
  if (m.base === 0) return "new this month";
  const rate = m.base < 1 ? "under 1" : Number.isInteger(m.base) ? String(m.base) : m.base.toFixed(1);
  return `${m.direction === "rising" ? "up" : "down"} from ${rate} a week`;
}
