import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { recordOwner } from "@/lib/auth/require-owner";
import { createHubStore } from "@/lib/hub/store";

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:54321 HUB_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> HUB_TEST_ANON_KEY=<ANON_KEY> (from `supabase status -o env`)
// Local Supabase has no real GitHub OAuth, so admin-made email users stand in for the two GitHub sign-ins.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const anonKey = process.env.HUB_TEST_ANON_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!enabled)("owner gate against local Supabase", () => {
  const service = () => createClient(apiUrl, serviceKey, noPersist);

  async function signedInUser() {
    const email = `hub-${randomUUID()}@example.test`;
    const password = randomUUID();
    const { data, error } = await service().auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const client = createClient(apiUrl, anonKey, noPersist);
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return { client, userId: data.user.id };
  }

  it("lets the owner read items and gives anyone else nothing", async () => {
    await createHubStore(service(), { kind: "agent", client: "integration" }).addItem({
      title: "integration owner gate",
      source: "test",
      clientKey: randomUUID(),
    });
    const owner = await signedInUser();
    const stranger = await signedInUser();
    await recordOwner(service(), owner.userId);

    const ownerRead = await owner.client.from("items").select("id");
    expect(ownerRead.error).toBeNull();
    expect(ownerRead.data!.length).toBeGreaterThan(0);
    expect((await owner.client.rpc("is_owner")).data).toBe(true);

    const strangerRead = await stranger.client.from("items").select("id");
    expect(strangerRead.error).toBeNull();
    expect(strangerRead.data).toEqual([]);
    expect((await stranger.client.rpc("is_owner")).data).toBe(false);
    expect((await stranger.client.from("hub_owner").select("user_id")).error).not.toBeNull();
  });

  it("records the owner idempotently", async () => {
    const owner = await signedInUser();
    await recordOwner(service(), owner.userId);
    await expect(recordOwner(service(), owner.userId)).resolves.toBeUndefined();
    const { data } = await service().from("hub_owner").select("user_id").eq("user_id", owner.userId);
    expect(data).toHaveLength(1);
  });
});
