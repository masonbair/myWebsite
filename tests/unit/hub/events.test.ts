import { describe, expect, it } from "vitest";
import * as route from "@/app/api/hub/events/[event]/route";
import { dueReminders, handleEventRequest, reminderKey, type EventDeps } from "@/lib/hub/events";
import type { Item } from "@/lib/hub/types";
import { createFakeStore, type FakeStore } from "./fake-store";

const TOKEN = "events-token";
const NOW = new Date("2026-11-05T18:00:00Z");

let counter = 0;
function item(overrides: Partial<Item> = {}): Item {
  const id = `00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;
  return {
    id,
    title: `item ${counter}`,
    description: "",
    labels: [],
    list: "todo",
    state: "open",
    due: null,
    mergedInto: null,
    source: "test",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    url: `https://masonbair.com/hub/item/${id}`,
    ...overrides,
  };
}

const dueAt = (date: string, time: string | null): Item["due"] => ({ date, time });

describe("dueReminders", () => {
  const utc = { timeZone: "UTC" };

  it("returns an item due 3 minutes ago and skips one due 10 minutes ago", () => {
    const recent = item({ due: dueAt("2026-11-05", "17:57:00") });
    const old = item({ due: dueAt("2026-11-05", "17:50:00") });
    expect(dueReminders([recent, old], NOW, 5, utc).map((i) => i.id)).toEqual([recent.id]);
  });

  it("skips an item not due yet and an all-day item", () => {
    const later = item({ due: dueAt("2026-11-05", "18:01:00") });
    const allDay = item({ due: dueAt("2026-11-05", null) });
    expect(dueReminders([later, allDay], NOW, 5, utc)).toEqual([]);
  });

  it("skips an item already reminded for this due time, but reminds again after a reschedule", () => {
    const reminded = item({ due: dueAt("2026-11-05", "17:58:00") });
    const moved = item({ due: dueAt("2026-11-05", "17:59:00") });
    const flags = new Map<string, unknown>([
      [reminded.id, "2026-11-05T17:58:00"],
      [moved.id, "2026-11-04T09:00:00"],
    ]);
    expect(dueReminders([reminded, moved], NOW, 5, { ...utc, reminded: flags }).map((i) => i.id)).toEqual([moved.id]);
  });

  it("skips done and archived items", () => {
    const due = dueAt("2026-11-05", "17:58:00");
    expect(dueReminders([item({ due, state: "done" }), item({ due, state: "archived" })], NOW, 5, utc)).toEqual([]);
  });

  it("reads the due time as Mason's wall clock", () => {
    // 10:57 in Denver on 5 November is 17:57 UTC (MST, UTC-7).
    const denver = item({ due: dueAt("2026-11-05", "10:57:00") });
    expect(dueReminders([denver], NOW, 5, { timeZone: "America/Denver" })).toEqual([denver]);
  });
});

type Fetched = { url: string; init: RequestInit };

function harness(overrides: Partial<EventDeps> = {}) {
  const store: FakeStore = createFakeStore({ kind: "worker", runId: "events" });
  const fetched: Fetched[] = [];
  const deps: EventDeps = {
    token: TOKEN,
    store: () => store,
    now: () => NOW,
    timeZone: "UTC",
    ntfyTopic: "topic-x",
    routine: { url: "https://routine.example/fire", token: "routine-token" },
    fetchFn: (async (url: string, init: RequestInit) => {
      fetched.push({ url, init });
      return new Response("{}");
    }) as unknown as typeof fetch,
    backup: async () => ({ path: "hub-backups/2026-11-05.json", pruned: [] }),
    ...overrides,
  };
  const call = (event: string, body: unknown = {}, auth = `Bearer ${TOKEN}`) =>
    handleEventRequest(
      new Request(`https://masonbair.com/api/hub/events/${event}`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      event,
      deps,
    );
  return { store, fetched, deps, call };
}

function seed(store: FakeStore, overrides: Partial<Item>): Item {
  const seeded = item(overrides);
  store.rows.items.set(seeded.id, seeded);
  return seeded;
}

describe("event auth", () => {
  it("refuses a wrong token and fails closed with no token set", async () => {
    expect((await harness().call("reminders", {}, "Bearer nope")).status).toBe(401);
    expect((await harness({ token: undefined }).call("reminders")).status).toBe(503);
    expect((await harness({ token: "" }).call("reminders")).status).toBe(503);
  });

  it("answers 404 for an unknown event", async () => {
    expect((await harness().call("delete")).status).toBe(404);
  });

  it("exports only POST from the route", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});

describe("reminders event", () => {
  it("notifies once per due item and records the flag", async () => {
    const h = harness();
    const due = seed(h.store, { title: "call the bank", due: dueAt("2026-11-05", "17:57:00") });
    seed(h.store, { due: dueAt("2026-11-05", "17:40:00") });

    const first = await h.call("reminders");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ reminded: [due.id] });
    expect(h.fetched).toHaveLength(1);
    expect(h.fetched[0].url).toBe("https://ntfy.sh/");
    expect(JSON.parse(h.fetched[0].init.body as string)).toMatchObject({ topic: "topic-x", title: "call the bank", click: due.url });
    expect(h.store.rows.state.get(reminderKey(due.id))).toBe("2026-11-05T17:57:00");

    await h.call("reminders");
    expect(h.fetched).toHaveLength(1);
  });

  it("leaves no flag when the notification fails, so the next run tries again", async () => {
    const h = harness({ fetchFn: (async () => new Response("no", { status: 429 })) as unknown as typeof fetch });
    const due = seed(h.store, { due: dueAt("2026-11-05", "17:57:00") });
    expect((await h.call("reminders")).status).toBe(502);
    expect(h.store.rows.state.has(reminderKey(due.id))).toBe(false);
  });

  it("is 503 without an ntfy topic", async () => {
    expect((await harness({ ntfyTopic: undefined }).call("reminders")).status).toBe(503);
  });
});

describe("approved event", () => {
  it("fires the routine the way todo-hub's relay does", async () => {
    const h = harness();
    const approved = seed(h.store, { labels: ["todo", "claude"] });
    const res = await h.call("approved", { id: approved.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fired: true });
    expect(h.fetched).toHaveLength(1);
    expect(h.fetched[0].url).toBe("https://routine.example/fire");
    expect(h.fetched[0].init.method).toBe("POST");
    expect(h.fetched[0].init.headers).toEqual({
      Authorization: "Bearer routine-token",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(h.fetched[0].init.body as string)).toEqual({ text: `hub-item-id: ${approved.id}` });
  });

  it("ignores an item without claude, one already claude-working, and one not open", async () => {
    const h = harness();
    const ids = [
      seed(h.store, { labels: ["todo"] }).id,
      seed(h.store, { labels: ["claude", "claude-working"] }).id,
      seed(h.store, { labels: ["claude"], state: "done" }).id,
    ];
    for (const id of ids) {
      const res = await h.call("approved", { id });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ fired: false });
    }
    expect(h.fetched).toEqual([]);
  });

  it("is 503 and fires nothing when the routine env vars are missing", async () => {
    const h = harness({ routine: null });
    const approved = seed(h.store, { labels: ["claude"] });
    expect((await h.call("approved", { id: approved.id })).status).toBe(503);
    expect(h.fetched).toEqual([]);
  });

  it("needs an item id and a known item", async () => {
    const h = harness();
    expect((await h.call("approved", { id: "nope" })).status).toBe(400);
    expect((await h.call("approved", { id: "00000000-0000-4000-9000-999999999999" })).status).toBe(404);
  });

  it("is 502 when the routine refuses", async () => {
    const h = harness({ fetchFn: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch });
    const approved = seed(h.store, { labels: ["claude"] });
    expect((await h.call("approved", { id: approved.id })).status).toBe(502);
  });
});

describe("backup event", () => {
  it("runs the backup and reports the file", async () => {
    const res = await harness().call("backup");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "hub-backups/2026-11-05.json", pruned: [] });
  });

  it("is 503 when no blob store is connected", async () => {
    expect((await harness({ backup: null }).call("backup")).status).toBe(503);
  });
});
