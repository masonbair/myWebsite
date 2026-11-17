import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/hub/rules";
import { createFakeStore, type FakeStore } from "./fake-store";

let store: FakeStore;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: vi.fn(async () => ({ userId: "owner" })) }));
vi.mock("@/lib/hub/mason-store", () => ({ masonStore: async () => store }));
vi.mock("@/lib/supabase/server", () => ({ sessionClient: vi.fn() }));

const { approveItem, completeItem, reopenItem, updateItemAction } = await import("@/app/hub/actions");

describe("hub actions", () => {
  beforeEach(() => {
    store = createFakeStore({ kind: "mason" });
    vi.unstubAllEnvs();
  });

  it("refuses to approve or add claude while the worker is off", async () => {
    vi.stubEnv("HUB_WORKER_LIVE", "false");
    const item = await store.addItem({ title: "a", labels: ["laptop"], source: "test" });
    await expect(approveItem(item.id)).rejects.toThrow("the worker is not live yet");
    await expect(updateItemAction(item.id, { labels: ["laptop", "claude"] })).rejects.toThrow("the worker is not live yet");
    expect((await store.getItem(item.id))?.labels).toEqual(["laptop"]);
  });

  it("still lets Mason remove claude or edit other labels while the worker is off", async () => {
    vi.stubEnv("HUB_WORKER_LIVE", "false");
    const item = await store.addItem({ title: "a", labels: ["claude"], source: "test" });
    await updateItemAction(item.id, { labels: ["claude", "laptop"] });
    await updateItemAction(item.id, { labels: ["laptop"] });
    expect((await store.getItem(item.id))?.labels).toEqual(["laptop"]);
  });

  it("approves and accepts claude once the worker is live", async () => {
    vi.stubEnv("HUB_WORKER_LIVE", "true");
    const first = await store.addItem({ title: "a", source: "test" });
    const second = await store.addItem({ title: "b", source: "test" });
    await approveItem(first.id);
    await updateItemAction(second.id, { labels: ["claude"] });
    expect((await store.getItem(first.id))?.labels).toEqual(["claude"]);
    expect((await store.getItem(second.id))?.labels).toEqual(["claude"]);
  });

  describe("starting the worker on approval", () => {
    let fired: { url: string; body: unknown }[];
    let status: number;

    beforeEach(() => {
      fired = [];
      status = 200;
      vi.stubEnv("HUB_WORKER_LIVE", "true");
      vi.stubEnv("ROUTINE_FIRE_URL", "https://routine.example/fire");
      vi.stubEnv("ROUTINE_FIRE_TOKEN", "routine-token");
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        fired.push({ url, body: JSON.parse(init.body as string) });
        return new Response("{}", { status });
      });
    });

    it("starts the routine once for the approved item, from the button or the label editor", async () => {
      const first = await store.addItem({ title: "a", source: "test" });
      const second = await store.addItem({ title: "b", source: "test" });
      await approveItem(first.id);
      await updateItemAction(second.id, { labels: ["claude"] });
      expect(fired).toEqual([
        { url: "https://routine.example/fire", body: { text: `hub-item-id: ${first.id}` } },
        { url: "https://routine.example/fire", body: { text: `hub-item-id: ${second.id}` } },
      ]);
    });

    it("does not start it for an item already approved or for other label edits", async () => {
      const item = await store.addItem({ title: "a", labels: ["claude"], source: "test" });
      await approveItem(item.id);
      await updateItemAction(item.id, { labels: ["claude", "laptop"] });
      await updateItemAction(item.id, { labels: ["laptop"] });
      expect(fired).toEqual([]);
    });

    it("keeps the approval when the routine refuses or is not configured", async () => {
      status = 500;
      const refused = await store.addItem({ title: "a", source: "test" });
      await approveItem(refused.id);
      vi.stubEnv("ROUTINE_FIRE_URL", "");
      const unset = await store.addItem({ title: "b", source: "test" });
      await approveItem(unset.id);
      expect((await store.getItem(refused.id))?.labels).toEqual(["claude"]);
      expect((await store.getItem(unset.id))?.labels).toEqual(["claude"]);
      expect(fired).toHaveLength(1);
    });
  });

  it("will not complete or reopen an archived item", async () => {
    const keep = await store.addItem({ title: "keep", source: "test" });
    const dupe = await store.addItem({ title: "dupe", source: "test" });
    await store.archive(dupe.id, "merged", keep.id, "Merged into keep");
    await expect(completeItem(dupe.id)).rejects.toThrow(ForbiddenError);
    await expect(reopenItem(dupe.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses an id that is not a uuid", async () => {
    await expect(completeItem("../../etc")).rejects.toThrow("bad item id");
  });
});
