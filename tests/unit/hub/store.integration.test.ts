import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/hub/rules";
import { createHubStore } from "@/lib/hub/store";

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:54321 HUB_TEST_SERVICE_KEY=<local key from `supabase status -o env`>
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";

describe.skipIf(!enabled)("hub store against local Supabase", () => {
  it("only talks to a local database", () => {
    expect(new URL(apiUrl).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    expect(serviceKey).not.toBe("");
  });

  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const agent = { kind: "agent", client: "integration" } as const;
  const worker = { kind: "worker", runId: "integration" } as const;

  it("refuses an agent completing an item", async () => {
    const store = createHubStore(client(), agent);
    const item = await store.addItem({ title: "integration complete", source: "test", clientKey: randomUUID() });
    await expect(store.complete(item.id)).rejects.toThrow(ForbiddenError);
  });

  it("returns the same item for a repeated clientKey", async () => {
    const store = createHubStore(client(), agent);
    const clientKey = randomUUID();
    const first = await store.addItem({ title: "integration dupe", source: "test", clientKey });
    const second = await store.addItem({ title: "integration dupe again", source: "test", clientKey });
    expect(second.id).toBe(first.id);
  });

  it("backstops completion in the database even for the service role", async () => {
    const store = createHubStore(client(), agent);
    const item = await store.addItem({ title: "integration backstop", source: "test", clientKey: randomUUID() });
    const { error } = await client().from("items").update({ state: "done" }).eq("id", item.id);
    expect(error?.message).toMatch(/only the owner/);
  });

  it("archives with a note, claims once and writes audit rows", async () => {
    const store = createHubStore(client(), worker);
    const keep = await store.addItem({ title: "integration keep", labels: ["claude"], source: "test", clientKey: randomUUID() });
    const dupe = await store.addItem({ title: "integration dupe", source: "test", clientKey: randomUUID() });
    const archived = await store.archive(dupe.id, "merged", keep.id, "Merged into the kept item");
    expect(archived.state).toBe("archived");
    expect((await store.listComments(dupe.id)).map((c) => c.body)).toEqual(["Merged into the kept item"]);
    expect(await store.claim(keep.id)).toBe(true);
    expect(await store.claim(keep.id)).toBe(false);
    await store.setStatusLabels(keep.id, ["claude-done"]);
    expect((await store.getItem(keep.id))?.labels.sort()).toEqual(["claude", "claude-done"]);
    const { data } = await client().from("audit_log").select("actor, action").eq("item_id", keep.id);
    expect(data?.every((row) => row.actor === "worker:integration")).toBe(true);
    expect(data?.map((row) => row.action)).toEqual(expect.arrayContaining(["add", "claim", "set-status-labels"]));
  });
});
