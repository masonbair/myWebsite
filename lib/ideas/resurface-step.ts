import type { Message } from "@/lib/hub/notify";
import { GoogleError, GoogleRevoked, type CalendarEvent, type GoogleAccess } from "./google";
import { addDays, eventBody, localDate, pickEventDay, planSteps, type Step } from "./resurface";

export type ResurfaceRow = {
  id: number;
  itemId: string;
  step: Step;
  dueDate: string;
  eventDate: string | null;
  googleEventId: string | null;
  status: "planned" | "sent" | "closed" | "skipped";
};

export type ResurfaceIdea = {
  id: string;
  title: string;
  state: "open" | "done" | "archived";
  list: string;
  enrolled: boolean;
  scheduleFrom: string | null;
  remindersStopped: boolean;
  verdict: string | null;
  why: string | null;
  weekend: string | null;
};

/** What the resurface step reads and writes; rows are never deleted. */
export type ResurfaceStore = {
  /** Enrolled ideas with their latest review. */
  ideas(): Promise<ResurfaceIdea[]>;
  rows(): Promise<ResurfaceRow[]>;
  /** Adds a planned row and returns it; null when a row with the same item, step and due date already exists. */
  planRow(itemId: string, step: Step, dueDate: string): Promise<ResurfaceRow | null>;
  updateRow(id: number, columns: Partial<Pick<ResurfaceRow, "status" | "eventDate" | "googleEventId">>): Promise<void>;
  /** Marks Google disconnected; `forgetCalendar` also clears the calendar id so a reconnect makes a new one. */
  disconnectGoogle(forgetCalendar: boolean): Promise<void>;
  getFlag(key: string): Promise<unknown | null>;
  setFlag(key: string, value: unknown): Promise<void>;
};

export type ResurfaceDeps = {
  store: ResurfaceStore;
  google: () => Promise<GoogleAccess | "disconnected" | null>;
  timeZone: () => Promise<string>;
  now: () => Date;
  /** Absolute time (ms) the run must be done by. */
  deadline: number;
  ntfy: (msg: Message) => Promise<void>;
};

const GOOGLE_ROOM_MS = 10_000;
const MAX_PER_DAY = 3;
const SETTINGS_URL = "https://masonbair.com/hub/ideas/settings";
const REVOKED_MESSAGE = "Google access for the Ideas calendar was removed. Connect Google again on the Ideas settings page.";
const GONE_MESSAGE = "The Ideas calendar is gone. Connect Google again on the Ideas settings page.";

/** The Ideas calendar with its id fixed, so no caller can write to another calendar. */
export type BoundCalendar = {
  insert(ev: CalendarEvent): Promise<string>;
  patch(eventId: string, patch: Partial<CalendarEvent>): Promise<void>;
};

export function bindCalendar(access: GoogleAccess): BoundCalendar {
  const { calendar, calendarId } = access;
  return {
    insert: (ev) => calendar.insertEvent(calendarId, ev),
    patch: (eventId, patch) => calendar.patchEvent(calendarId, eventId, patch),
  };
}

class OutOfTime extends Error {}
class CalendarStopped extends Error {}

const isActive = (idea: ResurfaceIdea) =>
  idea.enrolled && idea.state === "open" && idea.list === "ideas" && !idea.remindersStopped && idea.scheduleFrom !== null;

/** Brings ideas back on the Ideas calendar; returns how many rows it sent, closed or skipped. */
export async function runResurface(deps: ResurfaceDeps): Promise<number> {
  const { store } = deps;
  const [ideas, rows, timeZone, access] = await Promise.all([store.ideas(), store.rows(), deps.timeZone(), deps.google()]);
  const today = localDate(deps.now(), timeZone);
  const tomorrow = addDays(today, 1);
  let calendar = access && access !== "disconnected" ? bindCalendar(access) : null;
  let handled = 0;

  // Every Google call goes through here: it keeps 10 seconds before the deadline and turns a dead connection into one message.
  async function google<T>(call: (c: BoundCalendar) => Promise<T>): Promise<T> {
    if (!calendar) throw new CalendarStopped();
    if (deps.now().getTime() > deps.deadline - GOOGLE_ROOM_MS) throw new OutOfTime();
    try {
      return await call(calendar);
    } catch (e) {
      const revoked = e instanceof GoogleRevoked;
      const gone = e instanceof GoogleError && e.status === 404;
      if (!revoked && !gone) {
        console.error(`ideas resurface google call failed: ${e instanceof GoogleError ? `${e.status} ${e.code ?? ""}` : "error"}`);
        calendar = null;
        throw new CalendarStopped();
      }
      calendar = null;
      await store.disconnectGoogle(gone);
      await notifyOnce(deps, `ideas-google-revoked:${today}`, {
        title: gone ? "Ideas calendar is gone" : "Ideas calendar disconnected",
        message: gone ? GONE_MESSAGE : REVOKED_MESSAGE,
        clickUrl: SETTINGS_URL,
      });
      throw new CalendarStopped();
    }
  }

  const byItem = new Map<string, ResurfaceRow[]>();
  for (const row of rows) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
  const taken = new Map<string, number>();
  for (const row of rows) if (row.status === "sent" && row.eventDate) taken.set(row.eventDate, (taken.get(row.eventDate) ?? 0) + 1);

  async function close(row: ResurfaceRow, idea: ResurfaceIdea): Promise<void> {
    if (row.status === "planned") {
      await store.updateRow(row.id, { status: "closed" });
      row.status = "closed";
      handled += 1;
      return;
    }
    if (row.status !== "sent" || !row.eventDate || row.eventDate < today) return;
    if (row.googleEventId) {
      const closed = eventBody({ ...idea, date: row.eventDate, timeZone, closed: true });
      await google((c) => c.patch(row.googleEventId as string, { summary: closed.summary, reminders: closed.reminders }));
    }
    await store.updateRow(row.id, { status: "closed" });
    row.status = "closed";
    handled += 1;
  }

  async function handleIdea(idea: ResurfaceIdea): Promise<void> {
    const own = byItem.get(idea.id) ?? [];
    if (!isActive(idea)) {
      for (const row of own) await close(row, idea).catch(swallowStopped);
      return;
    }
    const plan = planSteps(idea.scheduleFrom as string);
    const current = (row: ResurfaceRow) => plan[row.step - 1].due === row.dueDate;
    // Review again moves schedule_from, so open rows from the old schedule no longer match its dates.
    for (const row of own.filter((r) => !current(r))) await close(row, idea).catch(swallowStopped);

    const mine = own.filter(current).sort((a, b) => a.step - b.step);
    const open = mine.find((r) => r.status === "planned" || (r.status === "sent" && (r.eventDate ?? today) >= today));
    let row: ResurfaceRow | undefined = open;
    if (!row) {
      const last = mine.at(-1);
      const nextStep = last ? last.step + 1 : 1;
      if (nextStep > 3) return;
      // Another run that planned the same row first owns it; this run leaves it for the next.
      const planned = await store.planRow(idea.id, nextStep as Step, plan[nextStep - 1].due);
      if (!planned) return;
      row = planned;
    }
    if (row.status !== "planned") return;
    const day = pickEventDay(row.dueDate < tomorrow ? tomorrow : row.dueDate, taken, MAX_PER_DAY);
    if (day !== tomorrow) return;
    if (!calendar) {
      await store.updateRow(row.id, { status: "skipped" });
      handled += 1;
      return;
    }
    const target = row;
    try {
      const eventId = await google((c) => c.insert(eventBody({ ...idea, date: day, timeZone, closed: false })));
      await store.updateRow(target.id, { status: "sent", eventDate: day, googleEventId: eventId });
      taken.set(day, (taken.get(day) ?? 0) + 1);
      handled += 1;
    } catch (e) {
      swallowStopped(e);
    }
  }

  try {
    for (const idea of ideas) await handleIdea(idea);
  } catch (e) {
    if (!(e instanceof OutOfTime)) throw e;
    console.error("ideas resurface stopped at the deadline");
  }
  return handled;
}

function swallowStopped(e: unknown): void {
  if (!(e instanceof CalendarStopped)) throw e;
}

async function notifyOnce(deps: ResurfaceDeps, key: string, msg: Message): Promise<void> {
  if (await deps.store.getFlag(key)) return;
  try {
    await deps.ntfy(msg);
  } catch (e) {
    console.error(`ideas ntfy not sent for ${key}: ${(e as Error).message}`);
    return;
  }
  await deps.store.setFlag(key, deps.now().toISOString());
}
