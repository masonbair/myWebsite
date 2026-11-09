import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GoogleError, GoogleRevoked, type CalendarEvent, type GoogleAccess } from "@/lib/ideas/google";
import { eventBody, pickEventDay, planSteps } from "@/lib/ideas/resurface";
import { bindCalendar, eventIdFor, runResurface, type ResurfaceDeps, type ResurfaceIdea, type ResurfaceRow, type ResurfaceStore } from "@/lib/ideas/resurface-step";

const ZONE = "America/Denver";
// 2026-11-09 12:00 in Denver.
const NOW = new Date("2026-11-09T19:00:00Z");

function idea(id: string, over: Partial<ResurfaceIdea> = {}): ResurfaceIdea {
  return {
    id,
    title: `Idea ${id}`,
    state: "open",
    list: "ideas",
    enrolled: true,
    scheduleFrom: "2026-11-07",
    remindersStopped: false,
    verdict: "promising",
    why: "People want it. Second sentence.",
    weekend: "A landing page",
    ...over,
  };
}

function fakeStore(ideas: ResurfaceIdea[], rows: ResurfaceRow[] = []) {
  const flags = new Map<string, unknown>();
  const google = { connected: true, calendarId: "cal-ideas" as string | null };
  let nextId = rows.length + 1;
  const store: ResurfaceStore = {
    ideas: async () => ideas,
    rows: async () => rows.map((r) => ({ ...r })),
    async planRow(itemId, step, dueDate) {
      if (rows.some((r) => r.itemId === itemId && r.step === step && r.dueDate === dueDate)) return null;
      const row: ResurfaceRow = { id: nextId++, itemId, step, dueDate, eventDate: null, googleEventId: null, status: "planned" };
      rows.push(row);
      return { ...row };
    },
    async updateRow(id, columns) {
      Object.assign(rows.find((r) => r.id === id)!, columns);
    },
    async disconnectGoogle(forget) {
      google.connected = false;
      if (forget) google.calendarId = null;
    },
    getFlag: async (key) => flags.get(key) ?? null,
    setFlag: async (key, value) => void flags.set(key, value),
  };
  return { store, rows, flags, google };
}

// Has no delete, so a test passing proves nothing was deleted.
function fakeGoogle(fail?: (call: string) => Error | null) {
  const calls: { kind: string; calendarId: string; eventId?: string; body: Partial<CalendarEvent> }[] = [];
  let n = 0;
  const access: GoogleAccess = {
    calendarId: "cal-ideas",
    calendar: {
      async insertEvent(calendarId, ev) {
        calls.push({ kind: "insert", calendarId, body: ev });
        const err = fail?.("insert");
        if (err) throw err;
        return `ev-${++n}`;
      },
      async patchEvent(calendarId, eventId, patch) {
        calls.push({ kind: "patch", calendarId, eventId, body: patch });
        const err = fail?.("patch");
        if (err) throw err;
      },
    },
  };
  return { access, calls };
}

function deps(store: ResurfaceStore, google: GoogleAccess | "disconnected" | null, over: Partial<ResurfaceDeps> = {}) {
  const ntfy = vi.fn(async () => {});
  const d: ResurfaceDeps = {
    store,
    google: async () => google,
    timeZone: async () => ZONE,
    now: () => NOW,
    deadline: NOW.getTime() + 60_000,
    ntfy,
    ...over,
  };
  return { d, ntfy };
}

const sentRow = (id: number, itemId: string, eventDate: string, over: Partial<ResurfaceRow> = {}): ResurfaceRow => ({
  id,
  itemId,
  step: 1,
  dueDate: eventDate,
  eventDate,
  googleEventId: `g-${id}`,
  status: "sent",
  ...over,
});

describe("planSteps", () => {
  it("returns +3 days, +2 weeks and +2 months", () => {
    expect(planSteps("2026-11-09")).toEqual([
      { step: 1, due: "2026-11-12" },
      { step: 2, due: "2026-11-23" },
      { step: 3, due: "2027-01-09" },
    ]);
  });

  it("keeps Jan 31 + 2 months on Mar 31 and Nov 30 on Jan 30", () => {
    expect(planSteps("2027-01-31")[2].due).toBe("2027-03-31");
    expect(planSteps("2026-11-30")[2].due).toBe("2027-01-30");
    expect(planSteps("2026-12-31")[2].due).toBe("2027-02-28");
  });
});

describe("pickEventDay", () => {
  it("moves the fourth idea on a day to the next day", () => {
    const taken = new Map([["2026-11-10", 3], ["2026-11-11", 3]]);
    expect(pickEventDay("2026-11-10", taken)).toBe("2026-11-12");
    expect(pickEventDay("2026-11-10", new Map([["2026-11-10", 2]]))).toBe("2026-11-10");
  });
});

describe("eventBody", () => {
  it("is a private 09:00-09:10 event with one popup and the idea link", () => {
    const ev = eventBody({ id: "i1", title: "Dog app", verdict: "strong", why: "Big need. More.", weekend: "A form", date: "2026-11-10", timeZone: ZONE, closed: false });
    expect(ev.summary).toBe("Idea: Dog app");
    expect(ev.description).toBe("Verdict: strong. Big need.\nWeekend version: A form\nhttps://masonbair.com/hub/ideas/i1");
    expect(ev.start).toEqual({ dateTime: "2026-11-10T09:00:00", timeZone: ZONE });
    expect(ev.end).toEqual({ dateTime: "2026-11-10T09:10:00", timeZone: ZONE });
    expect(ev.visibility).toBe("private");
    expect(ev.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 0 }] });
  });

  it("says the review is waiting and drops the popup when closed", () => {
    const ev = eventBody({ id: "i1", title: "Dog app", verdict: null, why: null, weekend: null, date: "2026-11-10", timeZone: ZONE, closed: true });
    expect(ev.summary).toBe("Idea (closed): Dog app");
    expect(ev.description).toBe("Review is waiting.\nhttps://masonbair.com/hub/ideas/i1");
    expect(ev.reminders).toEqual({ useDefault: false, overrides: [] });
  });
});

describe("bindCalendar", () => {
  it("only ever writes to the bound calendar id", async () => {
    const g = fakeGoogle();
    const bound = bindCalendar(g.access);
    await bound.insert(eventBody({ id: "i", title: "t", verdict: null, why: null, weekend: null, date: "2026-11-10", timeZone: ZONE, closed: false }));
    await bound.patch("ev-1", { summary: "x" });
    expect(g.calls.map((c) => c.calendarId)).toEqual(["cal-ideas", "cal-ideas"]);
    expect(bound.insert.length).toBe(1);
  });
});

describe("runResurface", () => {
  it("plans step 1 and creates its event the day before (Nov 10 is tomorrow)", async () => {
    const f = fakeStore([idea("a")]);
    const g = fakeGoogle();
    await runResurface(deps(f.store, g.access).d);
    expect(f.rows).toMatchObject([{ itemId: "a", step: 1, dueDate: "2026-11-10", status: "sent", eventDate: "2026-11-10", googleEventId: "idear1" }]);
    expect(g.calls[0].body).toMatchObject({ id: "idear1" });
    expect(g.calls).toHaveLength(1);
  });

  it("plans but does not create an event that is not due tomorrow", async () => {
    const f = fakeStore([idea("a", { scheduleFrom: "2026-11-09" })]);
    const g = fakeGoogle();
    await runResurface(deps(f.store, g.access).d);
    expect(f.rows).toMatchObject([{ step: 1, dueDate: "2026-11-12", status: "planned" }]);
    expect(g.calls).toHaveLength(0);
  });

  it("keeps one planned row per idea after two overlapping runs", async () => {
    const f = fakeStore([idea("a", { scheduleFrom: "2026-11-09" })]);
    await Promise.all([runResurface(deps(f.store, null).d), runResurface(deps(f.store, null).d)]);
    expect(f.rows).toHaveLength(1);
  });

  it("never plans an imported idea that is not enrolled", async () => {
    const f = fakeStore([idea("a", { enrolled: false })]);
    await runResurface(deps(f.store, fakeGoogle().access).d);
    expect(f.rows).toHaveLength(0);
  });

  it("moves the fourth idea due tomorrow to the next day", async () => {
    const f = fakeStore([idea("a"), idea("b"), idea("c"), idea("d")]);
    const g = fakeGoogle();
    await runResurface(deps(f.store, g.access).d);
    expect(f.rows.filter((r) => r.status === "sent")).toHaveLength(3);
    expect(f.rows.find((r) => r.itemId === "d")).toMatchObject({ status: "planned", eventDate: null });
  });

  it("plans the next step once a sent event has passed, and nothing after step 3", async () => {
    const f = fakeStore([idea("a"), idea("b")], [
      sentRow(1, "a", "2026-11-10", { eventDate: "2026-11-08" }),
      sentRow(2, "b", "2027-01-07", { step: 3 }),
    ]);
    f.rows[1].eventDate = "2026-11-01";
    await runResurface(deps(f.store, null).d);
    expect(f.rows.filter((r) => r.itemId === "a").map((r) => [r.step, r.dueDate, r.status])).toEqual([
      [1, "2026-11-10", "sent"],
      [2, "2026-11-21", "planned"],
    ]);
    expect(f.rows.filter((r) => r.itemId === "b")).toHaveLength(1);
  });

  it("Review again closes the old open rows and plans step 1 from the new date", async () => {
    const f = fakeStore([idea("a", { scheduleFrom: "2026-11-09" })], [
      sentRow(1, "a", "2026-11-10", { dueDate: "2026-11-04", step: 1, eventDate: "2026-11-04", status: "sent" }),
      { id: 2, itemId: "a", step: 2, dueDate: "2026-11-15", eventDate: null, googleEventId: null, status: "planned" },
    ]);
    // Old step 2 was planned from Nov 1; also leave a future sent one from the old plan.
    f.rows.push(sentRow(3, "a", "2026-11-11", { step: 1, dueDate: "2026-10-30" }));
    const g = fakeGoogle();
    await runResurface(deps(f.store, g.access).d);
    expect(f.rows.find((r) => r.id === 2)!.status).toBe("closed");
    expect(f.rows.find((r) => r.id === 3)!.status).toBe("closed");
    expect(f.rows.find((r) => r.id === 1)!.status).toBe("sent");
    expect(f.rows.at(-1)).toMatchObject({ step: 1, dueDate: "2026-11-12", status: "planned" });
    expect(g.calls).toEqual([expect.objectContaining({ kind: "patch", eventId: "g-3" })]);
  });

  it("patches a promoted idea's future event closed and never deletes it", async () => {
    const f = fakeStore([idea("a", { list: "todo" })], [
      sentRow(1, "a", "2026-11-10"),
      sentRow(2, "a", "2026-11-05", { step: 2, dueDate: "2026-11-21" }),
      { id: 3, itemId: "a", step: 3, dueDate: "2027-01-07", eventDate: null, googleEventId: null, status: "planned" },
    ]);
    const g = fakeGoogle();
    await runResurface(deps(f.store, g.access).d);
    expect(g.calls).toEqual([
      { kind: "patch", calendarId: "cal-ideas", eventId: "g-1", body: { summary: "Idea (closed): Idea a", reminders: { useDefault: false, overrides: [] } } },
    ]);
    expect(f.rows.map((r) => r.status)).toEqual(["closed", "sent", "closed"]);
    expect(f.rows).toHaveLength(3);
  });

  it("closes rows for done, archived and stopped ideas too", async () => {
    const f = fakeStore(
      [idea("a", { state: "done" }), idea("b", { state: "archived" }), idea("c", { remindersStopped: true })],
      ["a", "b", "c"].map((id, n) => ({ id: n + 1, itemId: id, step: 1 as const, dueDate: "2026-11-10", eventDate: null, googleEventId: null, status: "planned" as const })),
    );
    await runResurface(deps(f.store, fakeGoogle().access).d);
    expect(f.rows.map((r) => r.status)).toEqual(["closed", "closed", "closed"]);
  });

  it("skips a due row while Google is disconnected and plans the next step on a later run", async () => {
    const f = fakeStore([idea("a")]);
    await runResurface(deps(f.store, "disconnected").d);
    expect(f.rows).toMatchObject([{ step: 1, status: "skipped" }]);
    await runResurface(deps(f.store, "disconnected").d);
    expect(f.rows.at(-1)).toMatchObject({ step: 2, dueDate: "2026-11-21", status: "planned" });
  });

  it("on revoke marks Google disconnected, sends one ntfy and makes no more calls", async () => {
    const f = fakeStore([idea("a"), idea("b")]);
    const g = fakeGoogle(() => new GoogleRevoked());
    const { d, ntfy } = deps(f.store, g.access);
    await runResurface(d);
    await runResurface(deps(f.store, fakeGoogle(() => new GoogleRevoked()).access, { ntfy }).d);
    expect(g.calls).toHaveLength(1);
    expect(f.google).toEqual({ connected: false, calendarId: "cal-ideas" });
    expect(ntfy).toHaveBeenCalledTimes(1);
    expect(f.flags.has("ideas-google-revoked:2026-11-09")).toBe(true);
  });

  it("on a 404 forgets the calendar id and sends one ntfy", async () => {
    const f = fakeStore([idea("a"), idea("b")]);
    const g = fakeGoogle(() => new GoogleError("event insert", 404, "notFound"));
    const { d, ntfy } = deps(f.store, g.access);
    await runResurface(d);
    expect(g.calls).toHaveLength(1);
    expect(f.google).toEqual({ connected: false, calendarId: null });
    expect(ntfy).toHaveBeenCalledWith(expect.objectContaining({ message: "The Ideas calendar is gone. Connect Google again on the Ideas settings page." }));
  });

  it("stops before a Google call inside the last 10 seconds", async () => {
    const f = fakeStore([idea("a")]);
    const g = fakeGoogle();
    await runResurface(deps(f.store, g.access, { deadline: NOW.getTime() + 5_000 }).d);
    expect(g.calls).toHaveLength(0);
    expect(f.rows).toMatchObject([{ status: "planned" }]);
  });

  it("gives each event its own id from the row, in Google's alphabet", () => {
    expect(eventIdFor(1)).toBe("idear1");
    expect(eventIdFor(1000)).toBe("idearv8");
    expect(eventIdFor(123456789)).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it("after a crash between insert and save, the next run's 409 marks the row sent with one event", async () => {
    const f = fakeStore([idea("a")]);
    const cal = calendarWithIds();
    const update = f.store.updateRow;
    let crash = true;
    f.store.updateRow = async (id, cols) => {
      if (crash && cols.status === "sent") {
        crash = false;
        throw new Error("db down");
      }
      return update(id, cols);
    };
    await expect(runResurface(deps(f.store, cal.access).d)).rejects.toThrow("db down");
    expect(f.rows[0].status).toBe("planned");
    await runResurface(deps(f.store, cal.access).d);
    expect(f.rows[0]).toMatchObject({ status: "sent", googleEventId: "idear1", eventDate: "2026-11-10" });
    expect(cal.events.size).toBe(1);
  });

  it("two runs on the same planned row make one event and both end sent", async () => {
    const f = fakeStore([idea("a")], [{ id: 1, itemId: "a", step: 1, dueDate: "2026-11-10", eventDate: null, googleEventId: null, status: "planned" }]);
    const cal = calendarWithIds();
    await Promise.all([runResurface(deps(f.store, cal.access).d), runResurface(deps(f.store, cal.access).d)]);
    expect(cal.inserts).toBe(2);
    expect(cal.events.size).toBe(1);
    expect(f.rows).toMatchObject([{ status: "sent", googleEventId: "idear1" }]);
  });

  it("a passing Google error stops calendar work but skips nothing and keeps the connection", async () => {
    const f = fakeStore([idea("a"), idea("b")]);
    const g = fakeGoogle(() => new GoogleError("event insert", 503, null));
    const { d, ntfy } = deps(f.store, g.access);
    await runResurface(d);
    expect(g.calls).toHaveLength(1);
    expect(f.rows.map((r) => r.status)).toEqual(["planned", "planned"]);
    expect(f.google).toEqual({ connected: true, calendarId: "cal-ideas" });
    expect(ntfy).not.toHaveBeenCalled();
  });

  it("a network error leaves a closing event's row sent for the next run", async () => {
    const f = fakeStore([idea("a", { state: "done" }), idea("b")], [sentRow(1, "a", "2026-11-12")]);
    const g = fakeGoogle(() => new TypeError("fetch failed"));
    await runResurface(deps(f.store, g.access).d);
    expect(f.rows.find((r) => r.id === 1)!.status).toBe("sent");
    expect(f.rows.find((r) => r.itemId === "b")!.status).toBe("planned");
    expect(g.calls).toHaveLength(1);
  });

  it("a patch 404 or 410 closes that row and keeps going, without touching the connection", async () => {
    const f = fakeStore([idea("a", { state: "done" }), idea("b", { state: "done" }), idea("c")], [sentRow(1, "a", "2026-11-12"), sentRow(2, "b", "2026-11-13")]);
    let n = 0;
    const g = fakeGoogle((kind) => (kind === "patch" ? new GoogleError("event patch", ++n === 1 ? 404 : 410, null) : null));
    const { d, ntfy } = deps(f.store, g.access);
    await runResurface(d);
    expect(f.rows.slice(0, 2).map((r) => r.status)).toEqual(["closed", "closed"]);
    expect(f.rows.find((r) => r.itemId === "c")!.status).toBe("sent");
    expect(f.google).toEqual({ connected: true, calendarId: "cal-ideas" });
    expect(ntfy).not.toHaveBeenCalled();
  });

  it("counts closed rows with an event date toward the day cap", async () => {
    const closed = (id: number): ResurfaceRow => sentRow(id, `old${id}`, "2026-11-10", { status: "closed" });
    const f = fakeStore([idea("a")], [closed(1), closed(2), sentRow(3, "old3", "2026-11-10")]);
    const g = fakeGoogle();
    await runResurface(deps(f.store, g.access).d);
    expect(g.calls).toHaveLength(0);
    expect(f.rows.at(-1)).toMatchObject({ itemId: "a", status: "planned" });
  });
});

// Behaves like Google with caller-set ids: a second insert of the same id answers 409.
function calendarWithIds() {
  const events = new Map<string, Partial<CalendarEvent>>();
  const cal = { events, inserts: 0, access: null as unknown as GoogleAccess };
  cal.access = {
    calendarId: "cal-ideas",
    calendar: {
      async insertEvent(_calendarId, ev) {
        cal.inserts += 1;
        await Promise.resolve();
        if (events.has(ev.id!)) throw new GoogleError("event insert", 409, "duplicate");
        events.set(ev.id!, ev);
        return ev.id!;
      },
      async patchEvent() {},
    },
  };
  return cal;
}
