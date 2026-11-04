import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/hub/rules";
import type { Actor, ItemPatch } from "@/lib/hub/types";
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
    const seed = createFakeStore(mason);
    const item = await seed.addItem({ title: "a", labels: ["claude", "claude-working", "laptop"], source: "test" });
    const store = createFakeStore(worker, seed.rows);
    await store.setStatusLabels(item.id, ["claude-done"]);
    expect((await store.getItem(item.id))?.labels.sort()).toEqual(["claude", "claude-done", "laptop"]);
    await expect(store.setStatusLabels(item.id, ["laptop"])).rejects.toThrow(ForbiddenError);
  });

  it("claim only works once for a claude item", async () => {
    const seed = createFakeStore(mason);
    const item = await seed.addItem({ title: "a", labels: ["claude"], source: "test" });
    const store = createFakeStore(worker, seed.rows);
    expect(await store.claim(item.id)).toBe(true);
    expect(await store.claim(item.id)).toBe(false);
  });

  it("ignores state and mergedInto smuggled into a patch", async () => {
    const store = createFakeStore(mason);
    const item = await store.addItem({ title: "a", source: "test" });
    const sneaky = { title: "b", state: "done", mergedInto: item.id } as unknown as ItemPatch;
    const updated = await store.updateItem(item.id, sneaky);
    expect(updated.title).toBe("b");
    expect(updated.state).toBe("open");
    expect(updated.mergedInto).toBeNull();
  });

  it("refuses a worker or agent archiving a done item, allows Mason", async () => {
    const shared = createFakeStore(mason);
    const keep = await shared.addItem({ title: "keep", source: "test" });
    const item = await shared.addItem({ title: "a", source: "test" });
    await shared.complete(item.id);
    await expect(createFakeStore(worker, shared.rows).archive(item.id, "merged", keep.id, "n")).rejects.toThrow(ForbiddenError);
    await expect(createFakeStore(agent, shared.rows).archive(item.id, "memo-split", null, "n")).rejects.toThrow(ForbiddenError);
    await expect(shared.archive(item.id, "merged", keep.id, "n")).resolves.toMatchObject({ state: "archived" });
  });

  it("refuses an empty archive note", async () => {
    const store = createFakeStore(worker);
    const item = await store.addItem({ title: "a", source: "test" });
    await expect(store.archive(item.id, "memo-split", null, "  ")).rejects.toThrow(ForbiddenError);
  });

  it("refuses worker and agent adding claude or status labels", async () => {
    for (const actor of [worker, agent]) {
      for (const label of ["claude", "claude-working", "claude-done", "claude-question"]) {
        await expect(createFakeStore(actor).addItem({ title: "a", labels: [label], source: "test" })).rejects.toThrow(ForbiddenError);
      }
    }
    await expect(createFakeStore(mason).addItem({ title: "a", labels: ["claude"], source: "test" })).resolves.toBeDefined();
    await expect(createFakeStore(agent).addItem({ title: "a", labels: ["todo"], source: "test" })).resolves.toBeDefined();
  });

  it("limits hub state to the worker", async () => {
    const shared = createFakeStore(worker);
    await shared.setHubState("k", { a: 1 });
    expect(await shared.getHubState("k")).toEqual({ a: 1 });
    for (const actor of [mason, agent]) {
      const other = createFakeStore(actor, shared.rows);
      await expect(other.getHubState("k")).rejects.toThrow(ForbiddenError);
      await expect(other.setHubState("k", 1)).rejects.toThrow(ForbiddenError);
    }
  });

  it("de-duplicates status labels and lists newest first", async () => {
    const store = createFakeStore(worker);
    const first = await store.addItem({ title: "first", labels: [], source: "test" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.addItem({ title: "second", source: "test" });
    await store.setStatusLabels(first.id, ["claude-done", "claude-done"]);
    expect((await store.getItem(first.id))?.labels).toEqual(["claude-done"]);
    expect((await store.listItems({})).map((i) => i.id)).toEqual([second.id, first.id]);
  });
});
