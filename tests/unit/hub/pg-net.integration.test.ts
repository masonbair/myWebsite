import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:54321 HUB_TEST_ANON_KEY=<ANON_KEY> (from `supabase status -o env`)
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const anonKey = process.env.HUB_TEST_ANON_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

// Supabase's own grants on pg_net can't be revoked by migrations, so this is the guard that keeps visitors from sending requests.
describe.skipIf(!enabled)("pg_net is out of reach of API visitors", () => {
  it("refuses the net schema over the API", async () => {
    const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "net" } });
    const { error } = await anon.rpc("http_get", { url: "https://example.com" });
    expect(error?.code).toBe("PGRST106");
  });

  it("refuses the event poster in public too", async () => {
    const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.rpc("hub_post_event", { p_event: "reminders" });
    expect(error).not.toBeNull();
  });
});
