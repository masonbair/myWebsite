import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { recordOwner } from "@/lib/auth/require-owner";
import { ForbiddenError } from "@/lib/hub/rules";
import { createHubStore } from "@/lib/hub/store";

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:54321 HUB_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> HUB_TEST_ANON_KEY=<ANON_KEY> (from `supabase status -o env`)
// HUB_TEST_DB_URL is the gate flag; the suite also refuses to load unless the API URL is local, because test rows can never be deleted.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const anonKey = process.env.HUB_TEST_ANON_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("hub store against local Supabase", () => {
  const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
  const client = () => createClient(apiUrl, serviceKey, noPersist);

  // The database only accepts the claude approval label from the signed-in owner, never the service role.
  async function signedInOwnerClient() {
    const email = `hub-${randomUUID()}@example.test`;
    const password = randomUUID();
    const { data, error } = await client().auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    await recordOwner(client(), data.user.id);
    const owner = createClient(apiUrl, anonKey, noPersist);
    const signIn = await owner.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return owner;
  }
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

  it("refuses an empty archive note and a protected label on add, leaving no rows", async () => {
    const store = createHubStore(client(), worker);
    const item = await store.addItem({ title: "integration note", source: "test", clientKey: randomUUID() });
    await expect(store.archive(item.id, "memo-split", null, " ")).rejects.toThrow(ForbiddenError);
    expect((await store.getItem(item.id))?.state).toBe("open");
    await expect(store.addItem({ title: "integration claude", labels: ["claude"], source: "test" })).rejects.toThrow(ForbiddenError);
  });

  it("matches labels with filter syntax in them literally in both label filters", async () => {
    const store = createHubStore(client(), worker);
    const odd = `odd,{x}"${randomUUID().slice(0, 8)}"\\`;
    const item = await store.addItem({ title: "integration odd label", labels: [odd, "plain"], source: "test", clientKey: randomUUID() });
    expect((await store.listItems({ withLabels: [odd] })).map((i) => i.id)).toEqual([item.id]);
    expect((await store.listItems({ withLabels: [odd, "plain"] })).map((i) => i.id)).toEqual([item.id]);
    const others = await store.listItems({ withLabels: ["plain"], withoutLabels: [odd] });
    expect(others.map((i) => i.id)).not.toContain(item.id);
  });

  it("limits hub state to the worker", async () => {
    await expect(createHubStore(client(), agent).getHubState("x")).rejects.toThrow(ForbiddenError);
    const key = `reminded:${randomUUID()}`;
    await createHubStore(client(), worker).setHubState(key, { ok: true });
    expect(await createHubStore(client(), worker).getHubState(key)).toEqual({ ok: true });
  });

  it("backstops completion in the database even for the service role", async () => {
    const store = createHubStore(client(), agent);
    const item = await store.addItem({ title: "integration backstop", source: "test", clientKey: randomUUID() });
    const { error } = await client().from("items").update({ state: "done" }).eq("id", item.id);
    expect(error?.message).toMatch(/only the owner/);
  });

  it("archives with a note, claims once and writes audit rows", async () => {
    const store = createHubStore(client(), worker);
    const keep = await createHubStore(await signedInOwnerClient(), { kind: "mason" }).addItem({
      title: "integration keep",
      labels: ["claude"],
      source: "test",
      clientKey: randomUUID(),
    });
    const dupe = await store.addItem({ title: "integration dupe", source: "test", clientKey: randomUUID() });
    const archived = await store.archive(dupe.id, "merged", keep.id, "Merged into the kept item");
    expect(archived.state).toBe("archived");
    expect((await store.listItems({ mergedInto: keep.id })).map((i) => i.id)).toEqual([dupe.id]);
    expect((await store.listComments(dupe.id)).map((c) => c.body)).toEqual(["Merged into the kept item"]);
    expect(await store.claim(keep.id)).toBe(true);
    expect(await store.claim(keep.id)).toBe(false);
    await store.setStatusLabels(keep.id, "claude-done");
    expect((await store.getItem(keep.id))?.labels).toEqual(["claude-done"]);
    expect(await store.claim(keep.id)).toBe(false);
    const { data } = await client().from("audit_log").select("actor, action").eq("item_id", keep.id);
    expect(data?.every((row) => row.actor === "worker:integration")).toBe(true);
    expect(data?.map((row) => row.action)).toEqual(expect.arrayContaining(["claim", "set-status-labels"]));
  });
});
