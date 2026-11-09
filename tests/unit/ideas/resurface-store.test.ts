import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createResurfaceStore } from "@/lib/ideas/resurface-store";
import { fakePostgrest } from "./fake-postgrest";

const TODAY = "2026-11-09";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;

/** 1500 enrolled open ideas (each with a past sent row and two reviews), plus ideas that are open, archived or filed elsewhere. */
function world() {
  const items: Row[] = [];
  const settings: Row[] = [];
  const reviews: Row[] = [];
  const resurface: Row[] = [];
  let n = 0;
  let rowId = 0;
  const idea = (state: string, list: string, enrolled: boolean | null) => {
    const id = uuid(++n);
    items.push({ id, title: `Idea ${n}`, state, list });
    if (enrolled !== null) settings.push({ item_id: id, enrolled, schedule_from: "2026-10-01", reminders_stopped_at: null });
    return id;
  };
  const row = (itemId: string, status: string, eventDate: string | null, step = 1) =>
    resurface.push({ id: ++rowId, item_id: itemId, step, due_date: "2026-10-04", event_date: eventDate, google_event_id: null, status });

  const active = Array.from({ length: 1500 }, () => idea("open", "ideas", true));
  for (const id of active) {
    row(id, "sent", "2026-10-05");
    reviews.push({ item_id: id, version: 1, review: { verdict: "old", why: "old", weekend: { build: "old" } } });
    reviews.push({ item_id: id, version: 2, review: { verdict: "promising", why: "new", weekend: { build: "A page" } } });
  }
  const notEnrolled = Array.from({ length: 100 }, () => idea("open", "ideas", false));
  const archivedQuiet = Array.from({ length: 50 }, () => idea("archived", "ideas", true));
  for (const id of archivedQuiet) row(id, "sent", "2026-10-05");
  const archivedPlanned = Array.from({ length: 30 }, () => idea("archived", "ideas", true));
  for (const id of archivedPlanned) row(id, "planned", null, 2);
  const promoted = idea("open", "todo", true);
  row(promoted, "sent", "2026-11-12");
  return { tables: { items, idea_settings: settings, idea_reviews: reviews, idea_resurface: resurface }, active, notEnrolled, archivedQuiet, archivedPlanned, promoted };
}

describe("createResurfaceStore load", () => {
  it("reads every page, keeps each request's URL short and takes only the latest review", async () => {
    const w = world();
    const fake = fakePostgrest(w.tables, { maxRows: 1000, maxUrl: 6000 });
    const { ideas, rows } = await createResurfaceStore(fake.client).load(TODAY);

    expect(fake.urls.every((url) => url.length <= 6000)).toBe(true);
    const ids = new Set(ideas.map((i) => i.id));
    expect(ids.size).toBe(1500 + 30 + 1);
    for (const id of [...w.active, ...w.archivedPlanned, w.promoted]) expect(ids.has(id)).toBe(true);
    for (const id of [...w.notEnrolled, ...w.archivedQuiet]) expect(ids.has(id)).toBe(false);

    expect(ideas.find((i) => i.id === w.active[1400])).toMatchObject({ verdict: "promising", why: "new", weekend: "A page", enrolled: true, state: "open" });
    expect(ideas.find((i) => i.id === w.archivedPlanned[0])).toMatchObject({ state: "archived", verdict: null });

    // Active ideas keep their past rows (they pick the next step); others only their planned or upcoming ones.
    const rowItems = rows.map((r) => r.itemId);
    expect(rows).toHaveLength(1500 + 30 + 1);
    expect(new Set(rowItems).has(w.archivedQuiet[0])).toBe(false);
    expect(rows.find((r) => r.itemId === w.active[1499])).toMatchObject({ status: "sent", eventDate: "2026-10-05" });
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort((a, b) => a - b));
  });

  it("fails loudly instead of truncating when a request is refused", async () => {
    const w = world();
    const fake = fakePostgrest(w.tables, { maxUrl: 500 });
    await expect(createResurfaceStore(fake.client).load(TODAY)).rejects.toMatchObject({ message: "414 URI Too Long" });
  });
});
