import { afterEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/hub/events/[event]/route";
import { dueReminders, handleEventRequest, masonTimeZone, reminderKey, reminderTimeZone, type EventDeps, type PlaceZone } from "@/lib/hub/events";
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
    const later = item({ due: dueAt("2026-11-05", "18:05:00") });
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

  it("by default reaches back 15 minutes and counts an item due within the next minute", () => {
    const late = item({ due: dueAt("2026-11-05", "17:46:00") });
    const tooLate = item({ due: dueAt("2026-11-05", "17:44:00") });
    const almost = item({ due: dueAt("2026-11-05", "18:01:00") });
    const future = item({ due: dueAt("2026-11-05", "18:02:00") });
    expect(dueReminders([late, tooLate, almost, future], NOW, undefined, utc).map((i) => i.id)).toEqual([late.id, almost.id]);
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
    latestPlaceZone: async () => null,
    ntfyTopic: "topic-x",
    routine: { url: "https://routine.example/fire", token: "routine-token" },
    fetchFn: (async (url: string, init: RequestInit) => {
      fetched.push({ url, init });
      return new Response("{}");
    }) as unknown as typeof fetch,
    backup: async () => ({ path: "hub-backups/2026-11-05.json", pruned: [], newestAt: "2026-11-05T17:59:00.000Z" }),
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

  it("exports only POST and the time limit from the route", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration"]);
    expect(route.maxDuration).toBe(300);
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

  it("retries a failed send on the next run, and reminds exactly once in total", async () => {
    let now = NOW;
    let failNext = true;
    const sent: string[] = [];
    const h = harness({
      now: () => now,
      fetchFn: (async (_url: string, init: RequestInit) => {
        if (failNext) {
          failNext = false;
          return new Response("no", { status: 503 });
        }
        sent.push(init.body as string);
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    seed(h.store, { due: dueAt("2026-11-05", "17:58:00") });

    expect((await h.call("reminders")).status).toBe(502);
    now = new Date(NOW.getTime() + 5 * 60_000);
    expect((await h.call("reminders")).status).toBe(200);
    now = new Date(NOW.getTime() + 10 * 60_000);
    await h.call("reminders");
    expect(sent).toHaveLength(1);
  });

  it("is 503 without an ntfy topic", async () => {
    expect((await harness({ ntfyTopic: undefined }).call("reminders")).status).toBe(503);
  });

  it("is 503 without a time zone rather than reading due times in a guessed one", async () => {
    expect((await harness({ timeZone: undefined }).call("reminders")).status).toBe(503);
  });

  describe("follows the zone of Mason's latest place ping", () => {
    // 09:00 in Lisbon on a summer day is 08:00Z; in Denver (the fallback) it is 15:00Z.
    const summerMorning = new Date("2026-07-01T08:02:00Z");
    const ping = (timeZone: string | null, daysOld: number): PlaceZone => ({
      timeZone,
      updatedAt: new Date(summerMorning.getTime() - daysOld * 86_400_000).toISOString(),
    });
    const remindedWith = async (place: PlaceZone | null) => {
      const h = harness({ now: () => summerMorning, timeZone: "America/Denver", latestPlaceZone: async () => place });
      const due = seed(h.store, { due: dueAt("2026-07-01", "09:00:00") });
      return { body: await (await h.call("reminders")).json(), id: due.id };
    };

    it("fires a 09:00 Lisbon reminder at 08:00Z when the recent ping says Europe/Lisbon", async () => {
      const { body, id } = await remindedWith(ping("Europe/Lisbon", 1));
      expect(body).toEqual({ reminded: [id] });
    });

    for (const [name, place] of [
      ["no ping", null],
      ["a ping without a zone", ping(null, 1)],
      ["an invalid zone", ping("Mars/Olympus", 1)],
      ["a ping over 7 days old", ping("Europe/Lisbon", 8)],
    ] as const) {
      it(`falls back to HUB_TIME_ZONE with ${name}`, async () => {
        expect((await remindedWith(place)).body).toEqual({ reminded: [] });
      });
    }
  });

  it("reminderTimeZone keeps the fallback for a ping dated in the future", () => {
    const now = new Date("2026-07-01T08:00:00Z");
    expect(reminderTimeZone({ timeZone: "Asia/Tokyo", updatedAt: "2026-07-02T08:00:00Z" }, "UTC", now)).toBe("UTC");
    expect(reminderTimeZone({ timeZone: "Asia/Tokyo", updatedAt: "2026-06-30T08:00:00Z" }, "UTC", now)).toBe("Asia/Tokyo");
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
    expect(await res.json()).toEqual({ path: "hub-backups/2026-11-05.json", pruned: [], newestAt: "2026-11-05T17:59:00.000Z" });
  });

  it("pings the phone and answers 500 when the backup throws", async () => {
    const h = harness({
      backup: async () => {
        throw new Error("blob store suspended");
      },
    });
    expect((await h.call("backup")).status).toBe(500);
    expect(h.fetched).toHaveLength(1);
    expect(JSON.parse(h.fetched[0].init.body as string)).toMatchObject({
      topic: "topic-x",
      title: "Hub backup failed: blob store suspended",
    });
  });

  it("pings the phone when the newest backup is over 36 hours old", async () => {
    const h = harness({
      backup: async () => ({ path: "hub-backups/2026-11-05.json", pruned: [], newestAt: "2026-11-03T03:00:00.000Z" }),
    });
    expect((await h.call("backup")).status).toBe(500);
    expect(JSON.parse(h.fetched[0].init.body as string).title).toMatch(/^Hub backup failed: newest backup is from 2026-11-03/);
  });

  it("is 503 when no blob store is connected", async () => {
    expect((await harness({ backup: null }).call("backup")).status).toBe(503);
  });
});

describe("ideas event", () => {
  const result = { detected: 0, reviewed: ["a"], failed: [], paused: false, resurfaced: 0 };

  it("answers 503 when no ideas runner is configured", async () => {
    expect((await harness({ ideas: null }).call("ideas")).status).toBe(503);
    expect((await harness().call("ideas")).status).toBe(503);
  });

  it("runs the ideas job and returns its result", async () => {
    let runs = 0;
    const res = await harness({ ideas: async () => (runs++, result) }).call("ideas");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(runs).toBe(1);
  });

  it("refuses a wrong token before running anything", async () => {
    let runs = 0;
    const res = await harness({ ideas: async () => (runs++, result) }).call("ideas", {}, "Bearer nope");
    expect(res.status).toBe(401);
    expect(runs).toBe(0);
  });
});

describe("event errors", () => {
  it("logs only the error's code, never its message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("row holds secret idea text"), { code: "PGRST116" });
    const res = await harness({ ideas: async () => Promise.reject(failure) }).call("ideas");
    expect(res.status).toBe(500);
    expect(log.mock.calls).toEqual([["hub event ideas failed: PGRST116"]]);
    log.mockRestore();
  });
});

describe("masonTimeZone", () => {
  afterEach(() => vi.unstubAllEnvs());

  const placeClient = (result: { data: unknown; error: unknown }) =>
    ({
      from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => result }) }) }) }),
    }) as unknown as Parameters<typeof masonTimeZone>[0];

  it("uses a recent place ping's zone", async () => {
    const client = placeClient({ data: { time_zone: "Asia/Tokyo", updated_at: "2026-11-05T00:00:00Z" }, error: null });
    expect(await masonTimeZone(client, NOW)).toBe("Asia/Tokyo");
  });

  it("falls back to HUB_TIME_ZONE, then Denver, when the read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = placeClient({ data: null, error: { code: "57014", message: "timeout" } });
    vi.stubEnv("HUB_TIME_ZONE", "Europe/Lisbon");
    expect(await masonTimeZone(failing, NOW)).toBe("Europe/Lisbon");
    vi.stubEnv("HUB_TIME_ZONE", "");
    expect(await masonTimeZone(failing, NOW)).toBe("America/Denver");
    expect(log.mock.calls.flat().join(" ")).not.toContain("timeout");
    log.mockRestore();
  });
});
