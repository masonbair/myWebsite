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
