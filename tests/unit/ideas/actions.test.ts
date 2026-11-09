import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeStore, type FakeStore } from "../hub/fake-store";

type Row = Record<string, unknown>;

let store: FakeStore;
let settings: Map<string, Row>;
let updateError: { message: string } | null;

/** Just the idea_settings calls the actions make, over a map keyed by item id. */
function fakeSessionClient() {
  return {
    from(table: string) {
      if (table !== "idea_settings") throw new Error(`unexpected table ${table}`);
      return {
        update: (cols: Row) => ({
          eq: (_column: string, id: string) => ({
            select: async () => {
              if (updateError) return { data: null, error: updateError };
              const row = settings.get(id);
              if (!row) return { data: [], error: null };
              Object.assign(row, cols);
              return { data: [{ item_id: id }], error: null };
            },
          }),
        }),
        insert: async (row: Row) => {
          settings.set(String(row.item_id), { ...row });
          return { error: null };
        },
        select: () => ({
          eq: (_column: string, id: string) => ({
            maybeSingle: async () => ({ data: settings.get(id) ?? null, error: null }),
          }),
        }),
      };
    },
  };
}

const requireOwner = vi.fn(async () => ({ userId: "owner" }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: () => requireOwner() }));
vi.mock("@/lib/hub/mason-store", () => ({ masonStore: async () => store }));
vi.mock("@/lib/supabase/server", () => ({ sessionClient: async () => fakeSessionClient() }));

const { backToInbox, promoteIdea, requestReview, setNoWebSearch, stopReminders } = await import("@/app/hub/ideas-actions");

const today = () => new Date().toISOString().slice(0, 10);

async function newIdea(extra: Row | null = { enrolled: true }) {
  const item = await store.addItem({ title: "an idea", list: "ideas", labels: ["idea"], source: "capture" });
  if (extra) settings.set(item.id, { item_id: item.id, ...extra });
  return item;
}

describe("ideas actions", () => {
  beforeEach(() => {
    store = createFakeStore({ kind: "mason" });
    settings = new Map();
    updateError = null;
    requireOwner.mockReset();
    requireOwner.mockImplementation(async () => ({ userId: "owner" }));
  });

  it("refuses anyone who is not the owner, before touching anything", async () => {
    const idea = await newIdea();
    requireOwner.mockImplementation(async () => {
      throw new Error("not the owner");
    });
    for (const act of [
      () => requestReview(idea.id, ""),
      () => promoteIdea(idea.id),
      () => stopReminders(idea.id),
      () => setNoWebSearch(idea.id, true),
      () => backToInbox(idea.id),
    ]) {
      await expect(act()).rejects.toThrow("not the owner");
    }
    expect(settings.get(idea.id)).toEqual({ item_id: idea.id, enrolled: true });
    expect((await store.getItem(idea.id))?.list).toBe("ideas");
  });

  it("refuses an id that is not a uuid", async () => {
    for (const act of [
      () => requestReview("../x", ""),
      () => promoteIdea("../x"),
      () => stopReminders("../x"),
      () => setNoWebSearch("../x", true),
      () => backToInbox("../x"),
    ]) {
      await expect(act()).rejects.toThrow("bad item id");
    }
  });

  it("refuses a review note over 2000 characters", async () => {
    const idea = await newIdea();
    await expect(requestReview(idea.id, "x".repeat(2001))).rejects.toThrow("note");
    expect(settings.get(idea.id)?.review_status).toBeUndefined();
  });

  it("queues a review again and restarts the schedule from today", async () => {
    const idea = await newIdea({ enrolled: true, review_status: "done", schedule_from: "2026-01-01" });
    expect(await requestReview(idea.id, "  think about pricing  ")).toEqual({ error: null });
    expect(settings.get(idea.id)).toMatchObject({
      review_status: "waiting",
      enrolled: true,
      schedule_from: today(),
      review_note: "think about pricing",
    });
    expect(typeof settings.get(idea.id)?.review_requested_at).toBe("string");
    await requestReview(idea.id, "   ");
    expect(settings.get(idea.id)?.review_note).toBeNull();
  });

  it("enrolls an older idea with no settings row", async () => {
    const idea = await newIdea(null);
    await requestReview(idea.id, "");
    expect(settings.get(idea.id)).toMatchObject({ item_id: idea.id, review_status: "waiting", enrolled: true, schedule_from: today() });
  });

  it("says plainly when a review is already running", async () => {
    const idea = await newIdea();
    updateError = { message: "a review is running; try again in a few minutes" };
    expect(await requestReview(idea.id, "")).toEqual({ error: "A review is running. Try again in a few minutes." });
  });

  it("will not review a closed idea", async () => {
    const idea = await newIdea();
    await store.complete(idea.id);
    await expect(requestReview(idea.id, "")).rejects.toThrow("open");
  });

  it("promotes to the todo list and stops reminders", async () => {
    const idea = await newIdea(null);
    await promoteIdea(idea.id);
    expect((await store.getItem(idea.id))?.list).toBe("todo");
    expect(typeof settings.get(idea.id)?.reminders_stopped_at).toBe("string");
  });

  it("stops reminders and switches web search", async () => {
    const idea = await newIdea();
    await stopReminders(idea.id);
    await setNoWebSearch(idea.id, true);
    expect(settings.get(idea.id)).toMatchObject({ no_web_search: true });
    expect(typeof settings.get(idea.id)?.reminders_stopped_at).toBe("string");
    await setNoWebSearch(idea.id, false);
    expect(settings.get(idea.id)?.no_web_search).toBe(false);
    await expect(setNoWebSearch(idea.id, "yes" as unknown as boolean)).rejects.toThrow();
  });

  it("sends a moved idea back to the inbox without the idea label, and never brings it back", async () => {
    const idea = await newIdea({ enrolled: true, moved_from_inbox: true });
    await store.updateItem(idea.id, { labels: ["idea", "laptop"] });
    await backToInbox(idea.id);
    const item = await store.getItem(idea.id);
    expect(item?.list).toBe("inbox");
    expect(item?.labels).toEqual(["laptop"]);
    expect(typeof settings.get(idea.id)?.reminders_stopped_at).toBe("string");
  });

  it("refuses back to inbox for an idea that was not moved", async () => {
    const idea = await newIdea({ enrolled: true, moved_from_inbox: false });
    await expect(backToInbox(idea.id)).rejects.toThrow("inbox");
    expect((await store.getItem(idea.id))?.list).toBe("ideas");
  });
});
