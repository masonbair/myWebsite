import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { formatLocation } from "@/lib/location";
import { loadNow, readNowRows } from "@/lib/now";

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:54321 HUB_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> HUB_TEST_ANON_KEY=<ANON_KEY> (from `supabase status -o env`)
// Rows can never be deleted, so each test writes the newest row with a unique name.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const anonKey = process.env.HUB_TEST_ANON_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

// backup.test.ts writes now rows in parallel, so a test that needs to write the newest row retries if it loses that race.
const NEWEST_ROW = { retry: 3 };

describe.skipIf(!enabled)("now tables against local Supabase", () => {
  const service = () => createClient(apiUrl, serviceKey, noPersist);

  it("reads the newest place and the latest bake, and loadNow prefers them over the file", NEWEST_ROW, async () => {
    const city = `Integrationville${randomUUID().slice(0, 8)}`;
    const name = `integration loaf ${randomUUID().slice(0, 8)}`;
    expect((await service().from("now_place").insert({ city, region: "Ohio", country: "United States", private: true })).error).toBeNull();
    expect((await service().from("now_bake").insert({ name, photo: "/misc/Mason_traveling.webp", baked_at: new Date().toISOString() })).error).toBeNull();

    const rows = await readNowRows(service());
    expect(rows.place).toMatchObject({ city, region: "Ohio", country: "United States", private: true });
    expect(rows.bake).toMatchObject({ name, photo: "/misc/Mason_traveling.webp" });

    const now = await loadNow({ rows: () => readNowRows(service()) });
    expect(now.bake?.name).toBe(name);
    expect(formatLocation(now.place!)).toBe("Ohio, United States");
  });

  it("a place marked private stays private when the phone pings it again as public", NEWEST_ROW, async () => {
    const city = `Hometown${randomUUID().slice(0, 8)}`;
    const ping = () => service().from("now_place").insert({ city, region: "Ohio", country: "United States", private: false });
    const mark = (makePrivate: boolean) =>
      service().from("now_place_privacy").insert({ city: city.toUpperCase(), region: "ohio", country: "united states", private: makePrivate });

    expect((await ping()).error).toBeNull();
    expect((await readNowRows(service())).place).toMatchObject({ city, private: false, sentPrivate: false });
    expect((await mark(true)).error).toBeNull();
    expect((await ping()).error).toBeNull();
    const now = await loadNow({ rows: () => readNowRows(service()) });
    expect(formatLocation(now.place!)).toBe("Ohio, United States");
    expect((await mark(false)).error).toBeNull();
    expect((await readNowRows(service())).place).toMatchObject({ city, private: false });
  });

  it("an older bake logged later does not replace the latest one", async () => {
    const name = `old loaf ${randomUUID().slice(0, 8)}`;
    expect((await service().from("now_bake").insert({ name, baked_at: "2020-01-01T00:00:00Z" })).error).toBeNull();
    expect((await readNowRows(service())).bake?.name).not.toBe(name);
  });

  it("gives anon and signed-in visitors no direct read", async () => {
    const anon = createClient(apiUrl, anonKey, noPersist);
    expect((await anon.from("now_place").select("city")).error).not.toBeNull();
    expect((await anon.from("now_bake").select("name")).error).not.toBeNull();
    expect((await anon.from("now_bake").insert({ name: "anon loaf" })).error).not.toBeNull();
    expect((await anon.from("now_place_privacy").select("city")).error).not.toBeNull();
    expect((await anon.rpc("now_current_place")).error).not.toBeNull();
  });
});
