import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { readBoardPhotos } from "@/lib/collector-photos";
import { readNowRows } from "@/lib/now";
import { servePhoto, supabasePhotoStore } from "@/lib/photo-server";
import { BUCKET, DAYLIO_PREFIX, PHOTO_PREFIX, RPC, TABLE, daylioPath, type PlaceRow } from "@/shared/collector-contract";

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:54321 HUB_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> HUB_TEST_ANON_KEY=<ANON_KEY> (from `supabase status -o env`)
// Rows can never be deleted, so every test writes rows with unique names.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const anonKey = process.env.HUB_TEST_ANON_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const OWNER_EMAIL = "collector-it-owner@example.test";
const OWNER_PASSWORD = "collector-it-owner-local-only";
// now.integration.test.ts and backup.test.ts also write now_place rows in parallel, so a newest-row test retries.
const NEWEST_ROW = { retry: 3 };
const COUNTRIES = path.join(__dirname, "../../apps/collector/src/place/countries.json");
// Storage checks only the declared type and size, so bare JPEG start and end markers are enough.
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(apiUrl, anonKey, noPersist);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

describe.skipIf(!enabled)("collector tables, RPCs and storage against local Supabase", () => {
  const service = () => createClient(apiUrl, serviceKey, noPersist);
  const anon = () => createClient(apiUrl, anonKey, noPersist);
  let owner: SupabaseClient;
  let stranger: SupabaseClient;

  beforeAll(async () => {
    const admin = service().auth.admin;
    const created = await admin.createUser({ email: OWNER_EMAIL, password: OWNER_PASSWORD, email_confirm: true });
    let ownerId = created.data.user?.id;
    if (!ownerId) {
      const { data, error } = await admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      ownerId = data.users.find((u) => u.email === OWNER_EMAIL)?.id;
    }
    if (!ownerId) throw created.error ?? new Error("could not create the collector test owner");
    const seeded = await service().from("hub_owner").upsert({ user_id: ownerId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (seeded.error) throw seeded.error;
    owner = await signedIn(OWNER_EMAIL, OWNER_PASSWORD);

    const strangerEmail = `collector-it-${randomUUID()}@example.test`;
    const strangerPassword = randomUUID();
    const other = await admin.createUser({ email: strangerEmail, password: strangerPassword, email_confirm: true });
    if (other.error) throw other.error;
    stranger = await signedIn(strangerEmail, strangerPassword);
  }, 30_000);

  describe("now_place", () => {
    const row = (over: Partial<PlaceRow>): PlaceRow => ({
      city: null,
      region: "Ohio",
      country: "United States",
      private: true,
      time_zone: "America/New_York",
      ...over,
    });

    it("takes a private place with no city from the owner, and now_current_place returns it", NEWEST_ROW, async () => {
      const region = `Privregion${randomUUID().slice(0, 8)}`;
      expect((await owner.from(TABLE.place).insert(row({ region }))).error).toBeNull();
      const { data, error } = await service().rpc("now_current_place").maybeSingle();
      expect(error).toBeNull();
      expect(data).toMatchObject({ city: null, region, country: "United States", private: true, sent_private: true });
      expect((await readNowRows(service())).place).toMatchObject({ city: null, region, private: true, sentPrivate: true });
    });

    it("refuses a public place with no city or a blank one", async () => {
      for (const city of [null, "", "   "]) {
        const { error } = await owner.from(TABLE.place).insert(row({ city, private: false }));
        expect(error?.message).toMatch(/now_place_city_check/);
      }
    });

    it("still refuses a blank city on a private place, a blank country and an unknown zone", async () => {
      expect((await owner.from(TABLE.place).insert(row({ city: "  " }))).error?.message).toMatch(/now_place_city_check/);
      expect((await owner.from(TABLE.place).insert(row({ city: "Kent", country: " " }))).error?.message).toMatch(/now_place_country_check/);
      expect((await owner.from(TABLE.place).insert(row({ time_zone: "Mars/Olympus" }))).error?.message).toMatch(/unknown time zone/);
    });

    it("refuses inserts from anyone but the owner and gives nobody a read", async () => {
      expect((await stranger.from(TABLE.place).insert(row({}))).error).not.toBeNull();
      expect((await anon().from(TABLE.place).insert(row({}))).error).not.toBeNull();
      expect((await owner.from(TABLE.place).select("city")).error).not.toBeNull();
    });
  });

  describe("collector_add_photo", () => {
    const args = (assetId: string) => ({
      p_path: `${PHOTO_PREFIX}${assetId}.jpg`,
      p_asset_id: assetId,
      p_taken_at: "2026-11-01T10:00:00Z",
      p_width: 4000,
      p_height: 3000,
    });
    const rows = async (assetId: string) => (await service().from("collector_photo").select("*").eq("asset_id", assetId)).data ?? [];

    it("adds one row however often the owner sends it", async () => {
      const assetId = `it${randomUUID().slice(0, 8)}`;
      expect((await owner.rpc(RPC.addPhoto, args(assetId))).error).toBeNull();
      expect((await owner.rpc(RPC.addPhoto, args(assetId))).error).toBeNull();
      const found = await rows(assetId);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ path: `collector/${assetId}.jpg`, width: 4000, height: 3000, hidden: false });
    });

    it("refuses a stranger, anon and a path outside collector/", async () => {
      const assetId = `it${randomUUID().slice(0, 8)}`;
      expect((await stranger.rpc(RPC.addPhoto, args(assetId))).error).not.toBeNull();
      expect((await anon().rpc(RPC.addPhoto, args(assetId))).error).not.toBeNull();
      expect((await owner.rpc(RPC.addPhoto, { ...args(assetId), p_path: `other/${assetId}.jpg` })).error).not.toBeNull();
      expect((await owner.rpc(RPC.addPhoto, { ...args(assetId), p_path: `collector/../${assetId}.jpg` })).error).not.toBeNull();
      expect((await owner.rpc(RPC.addPhoto, { ...args(assetId), p_path: `collector/other${assetId}.jpg` })).error).not.toBeNull();
      expect((await owner.rpc(RPC.addPhoto, { ...args(`${assetId}/x`), p_asset_id: `${assetId}/x` })).error).not.toBeNull();
      expect(await rows(assetId)).toHaveLength(0);
    });

    it("lets only the owner hide and unhide a photo, and never edit or delete it", async () => {
      const assetId = `it${randomUUID().slice(0, 8)}`;
      expect((await owner.rpc(RPC.addPhoto, args(assetId))).error).toBeNull();

      const hidden = await owner.rpc(RPC.setPhotoHidden, { p_asset_id: assetId, p_hidden: true });
      expect(hidden).toMatchObject({ error: null, data: true });
      expect((await rows(assetId))[0].hidden).toBe(true);

      expect((await stranger.rpc(RPC.setPhotoHidden, { p_asset_id: assetId, p_hidden: false })).error).not.toBeNull();
      expect((await anon().rpc(RPC.setPhotoHidden, { p_asset_id: assetId, p_hidden: false })).error).not.toBeNull();
      expect((await rows(assetId))[0].hidden).toBe(true);

      expect(await owner.rpc(RPC.setPhotoHidden, { p_asset_id: assetId, p_hidden: false })).toMatchObject({ error: null, data: true });
      expect((await rows(assetId))[0].hidden).toBe(false);
      expect(await owner.rpc(RPC.setPhotoHidden, { p_asset_id: "no-such-asset", p_hidden: true })).toMatchObject({ error: null, data: false });

      expect((await owner.from("collector_photo").update({ hidden: true }).eq("asset_id", assetId)).error).not.toBeNull();
      expect((await owner.from("collector_photo").select("asset_id")).error).not.toBeNull();
      expect((await service().from("collector_photo").update({ width: 1 }).eq("asset_id", assetId)).error?.message).toMatch(/only hidden/);
      expect((await service().from("collector_photo").delete().eq("asset_id", assetId)).error?.message).toMatch(/never deleted/);
      expect(await rows(assetId)).toHaveLength(1);
    });
  });

  describe("collector_add_daylio_export", () => {
    const modifiedMs = Date.parse("2026-11-02T08:00:00.250Z");
    const args = (filename: string, size = 12345) => ({
      p_path: daylioPath(filename, size, modifiedMs),
      p_filename: filename,
      p_size_bytes: size,
      p_modified_at: new Date(modifiedMs).toISOString(),
    });
    const rows = async (filename: string) =>
      (await service().from("collector_daylio_export").select("*").eq("filename", filename).order("size_bytes")).data ?? [];

    it("adds one row however often the owner sends it", async () => {
      const filename = `daylio_export_${randomUUID().slice(0, 8)}.csv`;
      expect((await owner.rpc(RPC.addDaylioExport, args(filename))).error).toBeNull();
      expect((await owner.rpc(RPC.addDaylioExport, args(filename))).error).toBeNull();
      expect(await rows(filename)).toHaveLength(1);
    });

    it("keeps a re-export with the same file name as a second row and a second object", async () => {
      const filename = `daylio export ${randomUUID().slice(0, 8)}.csv`;
      const csv = (text: string) => new Blob([text], { type: "text/csv" });
      for (const [size, body] of [
        [11, "a,b\n1,2\n"],
        [17, "a,b\n1,2\n3,4\n"],
      ] as const) {
        const a = args(filename, size);
        expect((await owner.storage.from(BUCKET.daylio).upload(a.p_path, csv(body), { contentType: "text/csv" })).error).toBeNull();
        expect((await owner.rpc(RPC.addDaylioExport, a)).error).toBeNull();
      }
      const found = await rows(filename);
      expect(found.map((r) => r.path)).toEqual([daylioPath(filename, 11, modifiedMs), daylioPath(filename, 17, modifiedMs)]);
      for (const r of found) expect((await service().storage.from(BUCKET.daylio).download(r.path)).error).toBeNull();
    });

    it("refuses a stranger, anon and a path that does not match the file's version", async () => {
      const filename = `daylio_export_${randomUUID().slice(0, 8)}.csv`;
      expect((await stranger.rpc(RPC.addDaylioExport, args(filename))).error).not.toBeNull();
      expect((await anon().rpc(RPC.addDaylioExport, args(filename))).error).not.toBeNull();
      expect((await owner.rpc(RPC.addDaylioExport, { ...args(filename), p_path: `${DAYLIO_PREFIX}${filename}` })).error).not.toBeNull();
      expect((await owner.rpc(RPC.addDaylioExport, { ...args(filename), p_path: daylioPath(filename, 999, modifiedMs) })).error).not.toBeNull();
      expect((await owner.rpc(RPC.addDaylioExport, { ...args(filename), p_path: `other/${filename}` })).error).not.toBeNull();
      expect(await rows(filename)).toHaveLength(0);
    });
  });

  describe("collector_heartbeat", () => {
    it("stores the owner's status as a new row, and refuses a stranger and anon", async () => {
      const at = new Date().toISOString();
      const key = `it-${randomUUID().slice(0, 8)}`;
      const p_status = { at, items: [{ key, ok: true }] };
      expect((await owner.rpc(RPC.heartbeat, { p_status })).error).toBeNull();
      const stored = await service().from("collector_heartbeat").select("status").contains("status", { items: [{ key }] });
      expect(stored.data).toEqual([{ status: p_status }]);

      expect((await stranger.rpc(RPC.heartbeat, { p_status: { at, items: [{ key: `${key}-x`, ok: true }] } })).error).not.toBeNull();
      expect((await anon().rpc(RPC.heartbeat, { p_status })).error).not.toBeNull();
      expect((await owner.from("collector_heartbeat").select("status")).error).not.toBeNull();
    });

    it("accepts exactly { at, items: [{ key, ok }] } and nothing else", async () => {
      const at = new Date().toISOString();
      expect((await owner.rpc(RPC.heartbeat, { p_status: { at, items: [] } })).error).toBeNull();
      expect((await owner.rpc(RPC.heartbeat, { p_status: { at: "2026-11-09T12:00:00+01:00", items: [{ key: "place:last_ok", ok: false }] } })).error).toBeNull();
      const bad: unknown[] = [
        [1, 2],
        {},
        { at },
        { at, items: [], extra: 1 },
        { at: 12, items: [] },
        { at: "yesterday", items: [] },
        { at, items: {} },
        { at, items: [{ key: "photos" }] },
        { at, items: [{ key: "photos", ok: "yes" }] },
        { at, items: [{ key: "Photos", ok: true }] },
        { at, items: [{ key: "x".repeat(41), ok: true }] },
        { at, items: [{ key: "photos", ok: true, note: "hi" }] },
        { at, items: ["photos"] },
      ];
      for (const p_status of bad) {
        const { error } = await owner.rpc(RPC.heartbeat, { p_status });
        expect(error?.message, JSON.stringify(p_status)).toMatch(/collector_heartbeat_status_check/);
      }
    });
  });

  describe("storage", () => {
    it("lets the owner add a photo under collector/ once, keeps it off the public internet, and lets nobody else write", async () => {
      const name = `${PHOTO_PREFIX}${randomUUID()}.jpg`;
      expect((await owner.storage.from(BUCKET.photos).upload(name, JPEG, { contentType: "image/jpeg" })).error).toBeNull();

      const again = await owner.storage.from(BUCKET.photos).upload(name, JPEG, { contentType: "image/jpeg" });
      expect(again.error?.message).toMatch(/exists|duplicate/i);
      const overwrite = await owner.storage.from(BUCKET.photos).upload(name, JPEG, { contentType: "image/jpeg", upsert: true });
      expect(overwrite.error).not.toBeNull();
      await owner.storage.from(BUCKET.photos).remove([name]);

      expect((await fetch(`${apiUrl}/storage/v1/object/public/photos/${name}`)).status).not.toBe(200);
      expect((await anon().storage.from(BUCKET.photos).download(name)).error).not.toBeNull();
      expect((await stranger.storage.from(BUCKET.photos).download(name)).error).not.toBeNull();
      expect((await anon().storage.from(BUCKET.photos).list("collector")).data ?? []).toEqual([]);
      const served = await service().storage.from(BUCKET.photos).download(name);
      expect(new Uint8Array(await served.data!.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

      expect((await owner.storage.from(BUCKET.photos).upload(`other/${randomUUID()}.jpg`, JPEG, { contentType: "image/jpeg" })).error).not.toBeNull();
      expect((await owner.storage.from(BUCKET.photos).upload(`${randomUUID()}.jpg`, JPEG, { contentType: "image/jpeg" })).error).not.toBeNull();
      expect(
        (await stranger.storage.from(BUCKET.photos).upload(`${PHOTO_PREFIX}${randomUUID()}.jpg`, JPEG, { contentType: "image/jpeg" })).error,
      ).not.toBeNull();
      expect(
        (await anon().storage.from(BUCKET.photos).upload(`${PHOTO_PREFIX}${randomUUID()}.jpg`, JPEG, { contentType: "image/jpeg" })).error,
      ).not.toBeNull();
    });

    it("keeps daylio exports private: the owner adds under exports/ only, and anon cannot read them", async () => {
      const csv = new Blob(["full_date,mood\n2026-11-01,good\n"], { type: "text/csv" });
      const name = daylioPath(`${randomUUID()}.csv`, 32, Date.now());
      expect((await owner.storage.from(BUCKET.daylio).upload(name, csv, { contentType: "text/csv" })).error).toBeNull();
      expect((await owner.storage.from(BUCKET.daylio).upload(`other/${randomUUID()}.csv`, csv, { contentType: "text/csv" })).error).not.toBeNull();
      expect(
        (await owner.storage.from(BUCKET.daylio).upload(`${DAYLIO_PREFIX}${randomUUID()}.csv`, csv, { contentType: "text/csv" })).error,
      ).not.toBeNull();
      expect(
        (await stranger.storage.from(BUCKET.daylio).upload(daylioPath(`${randomUUID()}.csv`, 32, Date.now()), csv, { contentType: "text/csv" })).error,
      ).not.toBeNull();

      expect((await fetch(`${apiUrl}/storage/v1/object/public/daylio/${name}`)).status).not.toBe(200);
      expect((await anon().storage.from(BUCKET.daylio).download(name)).error).not.toBeNull();
      expect((await stranger.storage.from(BUCKET.daylio).download(name)).error).not.toBeNull();
      await owner.storage.from(BUCKET.daylio).remove([name]);
      expect((await service().storage.from(BUCKET.daylio).download(name)).error).toBeNull();
    });
  });

  describe("the site's photo route", () => {
    it("serves a visible photo cleaned of its GPS EXIF, and stops once the owner hides it", async () => {
      const assetId = `it${randomUUID().slice(0, 8)}`;
      // Paris, a well-known public point, standing in for a location the phone failed to strip.
      const withGps = await sharp({ create: { width: 40, height: 30, channels: 3, background: "teal" } })
        .jpeg()
        .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 24/1", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 3/1" } })
        .toBuffer();
      const blob = new Blob([new Uint8Array(withGps)], { type: "image/jpeg" });
      expect((await owner.storage.from(BUCKET.photos).upload(`${PHOTO_PREFIX}${assetId}.jpg`, blob, { contentType: "image/jpeg" })).error).toBeNull();
      const add = { p_path: `${PHOTO_PREFIX}${assetId}.jpg`, p_asset_id: assetId, p_taken_at: new Date().toISOString(), p_width: 40, p_height: 30 };
      expect((await owner.rpc(RPC.addPhoto, add)).error).toBeNull();
      const options = { store: () => supabasePhotoStore(service()), includeHidden: false, cacheControl: "public, max-age=300" };

      expect((await readBoardPhotos(service())).map((p) => p.src)).toContain(`/photos/${assetId}`);
      const res = await servePhoto(assetId, null, options);
      expect(res.status).toBe(200);
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(false);
      expect(body.includes(Buffer.from("GPS"))).toBe(false);

      expect((await owner.rpc(RPC.setPhotoHidden, { p_asset_id: assetId, p_hidden: true })).data).toBe(true);
      expect((await readBoardPhotos(service())).map((p) => p.src)).not.toContain(`/photos/${assetId}`);
      expect((await servePhoto(assetId, null, options)).status).toBe(404);
      expect((await servePhoto(assetId, "256", { ...options, includeHidden: true })).status).toBe(200);

      expect((await owner.rpc(RPC.setPhotoHidden, { p_asset_id: assetId, p_hidden: false })).data).toBe(true);
      expect((await servePhoto(assetId, null, options)).status).toBe(200);
    });
  });

  describe("country names from the phone", () => {
    it.skipIf(!existsSync(COUNTRIES))("map to their own ISO code or their normalized text, never another country's code", async () => {
      const countries = JSON.parse(readFileSync(COUNTRIES, "utf8")) as Record<string, string>;
      const codes = Object.keys(countries).map((c) => c.toLowerCase());
      expect(codes.length).toBeGreaterThan(200);
      const db = service();
      const results: { code: string; name: string; mapped: string; norm: string }[] = [];
      const entries = Object.entries(countries);
      // In small batches, because hundreds of requests at once overrun the local API.
      for (let i = 0; i < entries.length; i += 10) {
        const batch = entries.slice(i, i + 10).map(async ([code, name]) => {
          const [mapped, norm] = await Promise.all([db.rpc("now_country_code", { p: name }), db.rpc("now_norm_text", { p: name })]);
          if (mapped.error) throw mapped.error;
          if (norm.error) throw norm.error;
          return { code: code.toLowerCase(), name, mapped: mapped.data as string, norm: norm.data as string };
        });
        results.push(...(await Promise.all(batch)));
      }
      const wrong = results.filter((r) => r.mapped !== r.code && (r.mapped !== r.norm || codes.includes(r.mapped)));
      expect(wrong).toEqual([]);
    }, 60_000);
  });
});
