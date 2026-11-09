import type { CalendarEvent } from "./google";

export type Step = 1 | 2 | 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const IDEA_URL = "https://masonbair.com/hub/ideas";

const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return format(parse(date) + days * DAY_MS);
}

// Jan 31 + 2 months lands on Mar 31, but Dec 31 + 2 months has no Feb 31, so the day is clamped to the month's end.
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return format(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
}

/** The three return dates for an idea whose schedule starts on `scheduleFrom` (YYYY-MM-DD). */
export function planSteps(scheduleFrom: string): { step: Step; due: string }[] {
  return [
    { step: 1, due: addDays(scheduleFrom, 3) },
    { step: 2, due: addDays(scheduleFrom, 14) },
    { step: 3, due: addMonths(scheduleFrom, 2) },
  ];
}

/** The first day on or after `due` holding fewer than `max` idea events. */
export function pickEventDay(due: string, takenByDate: Map<string, number>, max = 3): string {
  let day = due;
  while ((takenByDate.get(day) ?? 0) >= max) day = addDays(day, 1);
  return day;
}

/** The calendar date at `now` in `timeZone`, as YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function firstSentence(text: string): string {
  const match = text.trim().match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text.trim()).trim();
}

/** The Google event for one idea return: 09:00-09:10 local, private, one popup unless closed. */
export function eventBody(a: {
  id: string;
  title: string;
  verdict: string | null;
  why: string | null;
  weekend: string | null;
  date: string;
  timeZone: string;
  closed: boolean;
}): CalendarEvent {
  const verdictLine = a.verdict ? `Verdict: ${a.verdict}. ${firstSentence(a.why ?? "")}`.trim() : "Review is waiting.";
  const lines = [verdictLine, ...(a.weekend ? [`Weekend version: ${a.weekend}`] : []), `${IDEA_URL}/${a.id}`];
  return {
    summary: `${a.closed ? "Idea (closed)" : "Idea"}: ${a.title}`,
    description: lines.join("\n"),
    start: { dateTime: `${a.date}T09:00:00`, timeZone: a.timeZone },
    end: { dateTime: `${a.date}T09:10:00`, timeZone: a.timeZone },
    visibility: "private",
    reminders: { useDefault: false, overrides: a.closed ? [] : [{ method: "popup", minutes: 0 }] },
  };
}
