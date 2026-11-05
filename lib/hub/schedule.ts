import type { Item } from "./types";
import type { HubWorker } from "./worker-api";

export const WINDOW = [16 * 60, 21 * 60] as const;
export const BUDGET = 150;
export const HORIZON_DAYS = 14;
export const DEFAULT_MINUTES = 30;

export type Estimate = { id: string; minutes: number; timeBound: boolean };
/** The worker's plan: estimates most urgent first, busy times as ISO 8601 with offset, away days as YYYY-MM-DD. */
export type SchedulePlan = { estimates: Estimate[]; busy: { start: string; end: string }[]; away: string[] };
export type Day = { date: string; load: number; taken: [number, number][]; away: boolean };
type Dated = Pick<Item, "description" | "due">;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ESTIMATE_RE = /^estimate: (\d+) min$/m;
const DAY_MS = 86_400_000;

function array(v: unknown, where: string): Record<string, unknown>[] {
  if (!Array.isArray(v)) throw new Error(`${where} must be an array`);
  return v;
}

/** Check the worker's plan JSON; throws naming the bad field. */
export function parsePlan(json: unknown): SchedulePlan {
  if (typeof json !== "object" || json === null) throw new Error("plan must be an object");
  const data = json as Record<string, unknown>;
  const seen = new Set<string>();
  const estimates = array(data.estimates, "estimates").map((e, i) => {
    const where = `estimates[${i}]`;
    if (typeof e?.id !== "string" || !e.id) throw new Error(`${where}.id must be an item id`);
    if (seen.has(e.id)) throw new Error(`${where}.id ${e.id} is listed twice`);
    seen.add(e.id);
    const m = e.minutes;
    if (typeof m !== "number" || !Number.isInteger(m) || m % 15 || m < 15 || m > 300)
      throw new Error(`${where}.minutes must be a multiple of 15 from 15 to 300`);
    if (typeof e.timeBound !== "boolean") throw new Error(`${where}.timeBound must be true or false`);
    return { id: e.id, minutes: m, timeBound: e.timeBound };
  });
  const busy = array(data.busy, "busy").map((b, i) => {
    for (const key of ["start", "end"] as const)
      if (typeof b?.[key] !== "string" || !INSTANT_RE.test(b[key] as string))
        throw new Error(`busy[${i}].${key} must be an ISO time with an offset`);
    if (Date.parse(b.end as string) <= Date.parse(b.start as string)) throw new Error(`busy[${i}].end must be after start`);
    return { start: b.start as string, end: b.end as string };
  });
  const away = array(data.away, "away").map((d, i) => {
    if (typeof d !== "string" || !DATE_RE.test(d)) throw new Error(`away[${i}] must be YYYY-MM-DD`);
    return d;
  });
  return { estimates, busy, away };
}

export function estimateOf(description: string): number | null {
  const m = description.match(ESTIMATE_RE);
  return m ? Number(m[1]) : null;
}

export function withEstimate(description: string, minutes: number): string {
  const line = `estimate: ${minutes} min`;
  return ESTIMATE_RE.test(description) ? description.replace(ESTIMATE_RE, line) : `${description}\n${line}`;
}

/** An item's due date as a date plus minutes after midnight, or null time for all-day; hub dates are already wall-clock. */
export function localDue(due: NonNullable<Item["due"]>): { date: string; time: number | null } {
  if (due.time === null) return { date: due.date, time: null };
  return { date: due.date, time: Number(due.time.slice(0, 2)) * 60 + Number(due.time.slice(3, 5)) };
}

/** Minutes east of UTC for an IANA time zone at a given moment, following daylight saving. */
export function offsetMinutesAt(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const m = name?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function union(intervals: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Add a dated item to its day's load: all-day always, timed only when it starts inside the window. */
function count(day: Day, time: number | null, minutes: number): void {
  if (time !== null && (time < WINDOW[0] || time >= WINDOW[1])) return;
  day.load += minutes;
  if (time !== null) day.taken.push([time, time + minutes]);
}

/** The horizon's days with their evening load from calendar busy times and already-dated items. */
export function buildDays(a: {
  today: string;
  offsetMinutes: number;
  tasks: Dated[];
  busy: SchedulePlan["busy"];
  away: string[];
}): Day[] {
  return Array.from({ length: HORIZON_DAYS }, (_, i) => {
    const date = addDays(a.today, i + 1);
    // Local wall-clock minutes since the epoch, so a day's window is a plain range.
    const midnight = Date.parse(`${date}T00:00:00Z`) / 60_000;
    const busy = union(
      a.busy.flatMap(({ start, end }) => {
        const s = Math.max(Date.parse(start) / 60_000 + a.offsetMinutes - midnight, WINDOW[0]);
        const e = Math.min(Date.parse(end) / 60_000 + a.offsetMinutes - midnight, WINDOW[1]);
        return s < e ? [[s, e] as [number, number]] : [];
      }),
    );
    const day: Day = { date, load: busy.reduce((sum, [s, e]) => sum + e - s, 0), taken: busy, away: a.away.includes(date) };
    for (const t of a.tasks) {
      if (!t.due) continue;
      const due = localDue(t.due);
      if (due.date !== date) continue;
      count(day, due.time, estimateOf(t.description) ?? DEFAULT_MINUTES);
    }
    return day;
  });
}

function gap(day: Day, minutes: number): number | null {
  for (let s = WINDOW[0]; s + minutes <= WINDOW[1]; s += 15)
    if (!day.taken.some(([a, b]) => s < b && a < s + minutes)) return s;
  return null;
}

const lightest = (days: Day[]) => days.reduce((best, d) => (d.load < best.load ? d : best));

/** Pick a day (and, for a time-bound to-do, a start) and book it on that day. */
export function place(days: Day[], e: Estimate): { date: string; time: number | null } {
  const open = days.filter((d) => !d.away);
  const pool = open.length ? open : days.slice(0, 1);
  const fits = (d: Day) => d.load + e.minutes <= BUDGET && (!e.timeBound || gap(d, e.minutes) !== null);
  let day = pool.find(fits);
  if (!day) {
    const withGap = e.timeBound ? pool.filter((d) => gap(d, e.minutes) !== null) : [];
    day = lightest(withGap.length ? withGap : pool);
  }
  const time = e.timeBound ? gap(day, e.minutes) : null;
  day.load += e.minutes;
  if (time !== null) day.taken.push([time, time + e.minutes]);
  return { date: day.date, time };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const localToday = (now: Date, offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);

// The Inbox sort can turn a memo to-do into an idea or thought; those never get dates.
const notTodo = (t: Item) => t.labels.includes("idea") || t.labels.includes("thought");

async function waiting(hub: HubWorker): Promise<Item[]> {
  return (await hub.view("to-schedule")).filter((t) => t.labels.includes("to-schedule"));
}

/** What the worker needs to write a plan: the horizon (local wall-clock, no offset) and the waiting items. */
export async function scheduleInput(hub: HubWorker, now: Date, offsetMinutes: number) {
  const today = localToday(now, offsetMinutes);
  return {
    today,
    from: `${addDays(today, 1)}T00:00:00`,
    to: `${addDays(today, HORIZON_DAYS + 1)}T00:00:00`,
    tasks: (await waiting(hub)).filter((t) => !notTodo(t)).map((t) => {
      const due = t.due && localDue(t.due);
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        due: due ? { date: due.date, time: due.time === null ? null : hhmm(due.time) } : null,
      };
    }),
  };
}

/** Date each waiting to-do in the plan; returns one line per item, then the horizon's loads. */
export async function applySchedule(hub: HubWorker, plan: SchedulePlan, now: Date, offsetMinutes: number): Promise<string[]> {
  const today = localToday(now, offsetMinutes);
  const all = await waiting(hub);
  const pending = new Map(all.filter((t) => !notTodo(t)).map((t) => [t.id, t]));
  const others = (await hub.view("dated")).filter((t) => t.due && !t.labels.includes("to-schedule"));
  const days = buildDays({ today, offsetMinutes, tasks: others, busy: plan.busy, away: plan.away });
  const lines: string[] = [];
  const labels = (t: Item, add: string[]) => [...t.labels.filter((l) => l !== "to-schedule"), ...add];
  for (const t of all.filter(notTodo)) {
    await hub.updateItem(t.id, { labels: labels(t, []) });
    lines.push(`not a to-do ${t.id}: stopped waiting, no date`);
  }
  const known = plan.estimates.filter((e) => {
    if (pending.has(e.id)) return true;
    lines.push(`skipped ${e.id}: not waiting to be scheduled`);
    return false;
  });
  const minutes = new Map(known.map((e) => [e.id, e.minutes]));

  // Every stated date counts first, even one the plan left out, so nothing is placed on top of it.
  for (const t of pending.values()) {
    if (!t.due) continue;
    const due = localDue(t.due);
    const day = days.find((d) => d.date === due.date);
    if (day) count(day, due.time, minutes.get(t.id) ?? estimateOf(t.description) ?? DEFAULT_MINUTES);
  }
  for (const e of known) {
    const t = pending.get(e.id)!;
    if (!t.due) continue;
    await hub.updateItem(t.id, { description: withEstimate(t.description, e.minutes), labels: labels(t, []) });
    lines.push(`estimated ${t.id} ${e.minutes}m ${t.title}`);
  }
  for (const e of known) {
    const t = pending.get(e.id)!;
    if (t.due) continue;
    const { date, time } = place(days, e);
    const dueString = time === null ? date : `${date} ${hhmm(time)}`;
    await hub.updateItem(t.id, {
      due: { date, time: time === null ? null : hhmm(time) },
      description: withEstimate(t.description, e.minutes),
      labels: labels(t, ["suggested"]),
    });
    lines.push(`scheduled ${t.id} ${dueString} ${e.minutes}m ${t.title}`);
  }
  lines.push(`load: ${days.map((d) => `${d.date.slice(5)} ${d.away ? "away" : `${d.load}m`}`).join(", ")}`);
  return lines;
}
