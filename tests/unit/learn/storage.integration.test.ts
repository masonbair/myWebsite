import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:<port> HUB_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> HUB_TEST_ANON_KEY=<ANON_KEY>
// Storage inserts with RETURNING while learn-voice has no select policy, so only a real upload proves the owner can add a clip.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const anonKey = process.env.HUB_TEST_ANON_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const OWNER_EMAIL = "learn-it-owner@example.test";
const OWNER_PASSWORD = "learn-it-owner-local-only";
const BUCKET = "learn-voice";
// Storage checks only the declared type and size, so a few bytes stand in for a recording.
const CLIP = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(apiUrl, anonKey, noPersist);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

describe.skipIf(!enabled)("learn-voice storage against local Supabase", () => {
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
    if (!ownerId) throw created.error ?? new Error("could not create the learn test owner");
    const seeded = await service().from("hub_owner").upsert({ user_id: ownerId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (seeded.error) throw seeded.error;
    owner = await signedIn(OWNER_EMAIL, OWNER_PASSWORD);

    const strangerEmail = `learn-it-${randomUUID()}@example.test`;
    const strangerPassword = randomUUID();
    const other = await admin.createUser({ email: strangerEmail, password: strangerPassword, email_confirm: true });
    if (other.error) throw other.error;
    stranger = await signedIn(strangerEmail, strangerPassword);
  });

  it("lets the owner upload a clip once, and nobody else read, replace or remove it", async () => {
    const name = `answers/${randomUUID()}.webm`;
    expect((await owner.storage.from(BUCKET).upload(name, CLIP, { contentType: "audio/webm" })).error).toBeNull();

    expect((await owner.storage.from(BUCKET).upload(name, CLIP, { contentType: "audio/webm" })).error).not.toBeNull();
    expect((await owner.storage.from(BUCKET).upload(name, CLIP, { contentType: "audio/webm", upsert: true })).error).not.toBeNull();
    await owner.storage.from(BUCKET).remove([name]);
    await owner.storage.from(BUCKET).move(name, `answers/${randomUUID()}.webm`);

    const kept = await service().storage.from(BUCKET).download(name);
    expect(new Uint8Array(await kept.data!.arrayBuffer())).toEqual(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));

    expect((await fetch(`${apiUrl}/storage/v1/object/public/${BUCKET}/${name}`)).status).not.toBe(200);
    expect((await owner.storage.from(BUCKET).download(name)).error).not.toBeNull();
    expect((await stranger.storage.from(BUCKET).download(name)).error).not.toBeNull();
    expect((await anon().storage.from(BUCKET).download(name)).error).not.toBeNull();
  });

  it("refuses uploads outside answers/<uuid>, from a stranger, or signed out", async () => {
    expect((await owner.storage.from(BUCKET).upload(`other/${randomUUID()}.webm`, CLIP, { contentType: "audio/webm" })).error).not.toBeNull();
    expect((await owner.storage.from(BUCKET).upload(`answers/not-a-uuid.webm`, CLIP, { contentType: "audio/webm" })).error).not.toBeNull();
    expect((await stranger.storage.from(BUCKET).upload(`answers/${randomUUID()}.webm`, CLIP, { contentType: "audio/webm" })).error).not.toBeNull();
    expect((await anon().storage.from(BUCKET).upload(`answers/${randomUUID()}.webm`, CLIP, { contentType: "audio/webm" })).error).not.toBeNull();
  });
});
