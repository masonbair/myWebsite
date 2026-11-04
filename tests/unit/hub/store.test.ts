import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/hub/rules";
import type { Actor } from "@/lib/hub/types";
import { createFakeStore } from "./fake-store";

const mason: Actor = { kind: "mason" };
const worker: Actor = { kind: "worker", runId: "run-1" };
const agent: Actor = { kind: "agent", client: "claude-ai" };

describe("fake store rules", () => {
  it("refuses complete from an agent", async () => {
    const shared = createFakeStore(mason);
    const item = await shared.addItem({ title: "a", source: "test" });
    await expect(createFakeStore(agent, shared.rows).complete(item.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses a worker adding the claude label", async () => {
    const shared = createFakeStore(mason);
    const item = await shared.addItem({ title: "a", labels: ["todo"], source: "test" });
    const asWorker = createFakeStore(worker, shared.rows);
    await expect(asWorker.updateItem(item.id, { labels: [...item.labels, "claude"] })).rejects.toThrow(ForbiddenError);
  });

  it("refuses an agent touching a status label", async () => {
    const shared = createFakeStore(mason);
    const item = await shared.addItem({ title: "a", source: "test" });
    const asAgent = createFakeStore(agent, shared.rows);
    await expect(asAgent.updateItem(item.id, { labels: ["claude-done"] })).rejects.toThrow(ForbiddenError);
  });

  it("returns the existing item for a repeated clientKey", async () => {
    const store = createFakeStore(agent);
    const first = await store.addItem({ title: "a", source: "test", clientKey: "k1" });
    const second = await store.addItem({ title: "b", source: "test", clientKey: "k1" });
    expect(second.id).toBe(first.id);
  });

  it("refuses a merge with no surviving item", async () => {
    const store = createFakeStore(agent);
    const item = await store.addItem({ title: "a", source: "test" });
    await expect(store.archive(item.id, "merged", null, "x")).rejects.toThrow(ForbiddenError);
  });

  it("archives with a note comment", async () => {
    const store = createFakeStore(worker);
    const keep = await store.addItem({ title: "keep", source: "test" });
    const dupe = await store.addItem({ title: "dupe", source: "test" });
    const archived = await store.archive(dupe.id, "merged", keep.id, "Merged into keep");
    expect(archived.state).toBe("archived");
    expect(archived.mergedInto).toBe(keep.id);
    expect((await store.listComments(dupe.id)).map((c) => c.body)).toEqual(["Merged into keep"]);
  });

  it("setStatusLabels replaces only status labels and rejects others", async () => {
    const store = createFakeStore(worker);
    const item = await store.addItem({ title: "a", labels: ["claude", "claude-working", "laptop"], source: "test" });
    await store.setStatusLabels(item.id, ["claude-done"]);
    expect((await store.getItem(item.id))?.labels.sort()).toEqual(["claude", "claude-done", "laptop"]);
    await expect(store.setStatusLabels(item.id, ["laptop"])).rejects.toThrow(ForbiddenError);
  });

  it("claim only works once for a claude item", async () => {
    const store = createFakeStore(worker);
    const item = await store.addItem({ title: "a", labels: ["claude"], source: "test" });
    expect(await store.claim(item.id)).toBe(true);
    expect(await store.claim(item.id)).toBe(false);
  });
});
