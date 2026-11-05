import { describe, expect, it } from "vitest";
import * as route from "@/app/api/hub/worker/[...op]/route";
import { createHttpStore } from "@/lib/hub/http-store";
import { WORKER_ROUTES } from "@/lib/hub/worker-api";
import { BASE_URL, minutesAgo, seedItem, TOKEN, workerHarness } from "./worker-harness";

function call(h: ReturnType<typeof workerHarness>, path: string, init: RequestInit = {}, headers: Record<string, string> = {}) {
  return h.fetchFn(`${BASE_URL}/api/hub/worker/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "x-hub-run-id": "run-1", "content-type": "application/json", ...headers },
  });
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

describe("worker api auth", () => {
  it("refuses a missing or wrong token", async () => {
    const h = workerHarness();
    expect((await call(h, "health", {}, { authorization: "" })).status).toBe(401);
    expect((await call(h, "health", {}, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await call(h, "health")).status).toBe(200);
  });

  it("fails closed when the server has no token", async () => {
    for (const token of [undefined, ""]) {
      const h = workerHarness({}, { token });
      expect((await call(h, "health")).status).toBe(503);
      expect((await call(h, "health", {}, { authorization: "Bearer " })).status).toBe(503);
    }
  });

  it("needs a short safe run id", async () => {
    const h = workerHarness();
    expect((await call(h, "health", {}, { "x-hub-run-id": "" })).status).toBe(400);
    expect((await call(h, "health", {}, { "x-hub-run-id": "a b" })).status).toBe(400);
    expect((await call(h, "health", {}, { "x-hub-run-id": "x".repeat(65) })).status).toBe(400);
  });
});

describe("worker api surface", () => {
  it("has no route that completes, reopens or deletes", () => {
    for (const r of WORKER_ROUTES) {
      expect(r.method).not.toBe("DELETE");
      expect(r.path.join("/")).not.toMatch(/complete|reopen|delete|done/);
    }
    expect(Object.keys(route).sort()).toEqual(["GET", "PATCH", "POST", "PUT"]);
  });

  it("gives the HTTP client no complete, reopen or delete method", () => {
    const hub = createHttpStore(BASE_URL, TOKEN, "r", fetch) as unknown as Record<string, unknown>;
    for (const name of ["complete", "reopen", "delete", "deleteItem", "archive"]) expect(hub[name]).toBeUndefined();
  });

  it("answers 404 for an unknown op or item, 400 for a bad id", async () => {
    const h = workerHarness();
    expect((await call(h, "item/00000000-0000-4000-8000-000000000999/complete", post({}))).status).toBe(404);
    expect((await call(h, "item/00000000-0000-4000-8000-000000000999")).status).toBe(404);
    expect((await call(h, "item/not-a-uuid")).status).toBe(400);
  });

  it("refuses a body over 64 KB and bad JSON", async () => {
    const h = workerHarness();
    const item = seedItem(h.rows);
    expect((await call(h, `item/${item.id}/comment`, post({ body: "x".repeat(70_000) }))).status).toBe(413);
    expect((await call(h, `item/${item.id}/comment`, { method: "POST", body: "{nope" })).status).toBe(400);
    expect((await call(h, `item/${item.id}/comment`, post({ body: "x".repeat(10_001) }))).status).toBe(400);
    expect((await call(h, `item/${item.id}/comment`, post({ body: "  " }))).status).toBe(400);
  });
});

describe("worker api views", () => {
  it("approved lists only claimable items", async () => {
    const h = workerHarness();
    const free = seedItem(h.rows, { labels: ["claude"] });
    seedItem(h.rows, { labels: ["claude", "claude-working"], updatedAt: minutesAgo(5) });
    seedItem(h.rows, { labels: ["claude"], state: "done" });
    const res = await call(h, "approved");
    expect((await res.json()).map((i: { id: string }) => i.id)).toEqual([free.id]);
  });

  it("inbox lists only open, unsorted items no run holds", async () => {
    const h = workerHarness();
    const raw = seedItem(h.rows, { labels: ["laptop"] });
    for (const labels of [["todo"], ["idea"], ["thought"], ["hidock-memo"], ["claude"], ["claude-working"]]) seedItem(h.rows, { labels });
    seedItem(h.rows, { list: "todo" });
    seedItem(h.rows, { state: "archived" });
    expect((await (await call(h, "inbox")).json()).map((i: { id: string }) => i.id)).toEqual([raw.id]);
  });
});

describe("claim, finish, block", () => {
  it("two concurrent claims give one 200 and one 409", async () => {
    const h = workerHarness();
    const item = seedItem(h.rows, { labels: ["claude", "todo"] });
    const statuses = await Promise.all([call(h, `item/${item.id}/claim`, post({})), call(h, `item/${item.id}/claim`, post({}))]);
    expect(statuses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(h.rows.items.get(item.id)!.labels).toEqual(["todo", "claude", "claude-working"]);
  });

  it("finish posts the comment, drops claude, adds claude-done, and the item can't be claimed again", async () => {
    const h = workerHarness();
    const item = seedItem(h.rows, { labels: ["claude", "claude-working", "idea"] });
    const res = await call(h, `item/${item.id}/finish`, post({ comment: "Three ideas\nDetails" }));
    expect(res.status).toBe(200);
    expect(h.log).toEqual([`comment ${item.id} Three ideas`, `status ${item.id} claude-done`]);
    expect(h.rows.items.get(item.id)!.labels).toEqual(["idea", "claude-done"]);
    expect((await call(h, `item/${item.id}/claim`, post({}))).status).toBe(409);
  });

  it("a retried finish does not post the same comment twice", async () => {
    const h = workerHarness();
    const item = seedItem(h.rows, { labels: ["claude", "claude-working"] });
    await call(h, `item/${item.id}/finish`, post({ comment: "Done it" }));
    await call(h, `item/${item.id}/finish`, post({ comment: "Done it\n" }));
    expect(h.rows.comments.filter((c) => c.itemId === item.id)).toHaveLength(1);
  });

  it("block drops claude and adds claude-question", async () => {
    const h = workerHarness();
    const item = seedItem(h.rows, { labels: ["claude", "claude-working"] });
    expect((await call(h, `item/${item.id}/block`, post({ comment: "1. Which?" }))).status).toBe(200);
    expect(h.rows.items.get(item.id)!.labels).toEqual(["claude-question"]);
  });
});

describe("merge", () => {
  it("archives the newer item into the older one and copies the source note across", async () => {
    const h = workerHarness();
    const older = seedItem(h.rows, { title: "Book LA", labels: ["todo"] });
    const newer = seedItem(h.rows, { title: "Book LA trip", labels: ["hidock"] });
    const res = await call(h, `item/${newer.id}/merge`, post({ into: older.id, note: "> book LA\nSource: HiDock f.hda" }));
    expect(res.status).toBe(200);
    const archived = h.rows.items.get(newer.id)!;
    expect(archived).toMatchObject({ state: "archived", mergedInto: older.id });
    expect(h.rows.archivedReasons.get(newer.id)).toBe("merged");
    expect(h.rows.comments.filter((c) => c.itemId === newer.id).map((c) => c.body)).toEqual([`merged into ${older.url}`]);
    expect(h.rows.comments.filter((c) => c.itemId === older.id)).toEqual([
      expect.objectContaining({ body: "> book LA\nSource: HiDock f.hda", author: "worker" }),
    ]);
    expect(h.rows.items.get(older.id)!.state).toBe("open");
  });

  it("is safe to retry and never merges into itself or an archived item", async () => {
    const h = workerHarness();
    const older = seedItem(h.rows);
    const newer = seedItem(h.rows);
    const gone = seedItem(h.rows, { state: "archived" });
    const body = { into: older.id, note: "source" };
    expect((await call(h, `item/${newer.id}/merge`, post(body))).status).toBe(200);
    expect((await call(h, `item/${newer.id}/merge`, post(body))).status).toBe(200);
    expect(h.rows.comments).toHaveLength(2);
    const other = seedItem(h.rows);
    expect((await call(h, `item/${other.id}/merge`, post({ into: other.id, note: "n" }))).status).toBe(403);
    expect((await call(h, `item/${other.id}/merge`, post({ into: gone.id, note: "n" }))).status).toBe(409);
    expect((await call(h, `item/${other.id}/merge`, post({ into: older.id }))).status).toBe(400);
  });
});

describe("items, comments and state", () => {
  it("adds an inbox item and refuses the claude label", async () => {
    const h = workerHarness();
    const res = await call(h, "item", post({ title: "Call the bank", description: "Source: Granola", labels: [] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ title: "Call the bank", list: "inbox", source: "worker" });
    expect((await call(h, "item", post({ title: "x", labels: ["claude"] }))).status).toBe(403);
    expect((await call(h, "item", post({ description: "no title" }))).status).toBe(400);
  });

  it("patches an item but refuses adding claude or a status label", async () => {
    const h = workerHarness();
    const item = seedItem(h.rows, { labels: ["Proj"] });
    const res = await call(h, `item/${item.id}`, { method: "PATCH", body: JSON.stringify({ labels: ["Proj", "todo"], list: "todo" }) });
    expect(res.status).toBe(200);
    expect(h.rows.items.get(item.id)).toMatchObject({ labels: ["Proj", "todo"], list: "todo" });
    for (const label of ["claude", "claude-done"]) {
      const bad = await call(h, `item/${item.id}`, { method: "PATCH", body: JSON.stringify({ labels: ["Proj", label] }) });
      expect(bad.status).toBe(403);
    }
  });

  it("reads an item and its comments", async () => {
    const h = workerHarness();
    const item = seedItem(h.rows);
    await call(h, `item/${item.id}/comment`, post({ body: "hello" }));
    expect((await (await call(h, `item/${item.id}`)).json()).id).toBe(item.id);
    expect((await (await call(h, `item/${item.id}/comments`)).json()).map((c: { body: string }) => c.body)).toEqual(["hello"]);
  });

  it("stores and reads hub state, refusing a bad key", async () => {
    const h = workerHarness();
    expect(await (await call(h, "state/granola-swept-until")).json()).toEqual({ value: null });
    expect((await call(h, "state/granola-swept-until", { method: "PUT", body: JSON.stringify({ value: "2026-10-23T11:00:00.000Z" }) })).status).toBe(200);
    expect(await (await call(h, "state/granola-swept-until")).json()).toEqual({ value: "2026-10-23T11:00:00.000Z" });
    expect((await call(h, "state/Bad%20Key")).status).toBe(400);
    expect((await call(h, "state/k", { method: "PUT", body: JSON.stringify({}) })).status).toBe(400);
  });
});
