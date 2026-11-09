import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKUP_PREFIX,
  KEEP_BACKUPS,
  NEWS_ISSUE_COLUMNS,
  NEWS_SHARED_COLUMNS,
  backupPath,
  createSnapshotSource,
  runBackup,
  snapshot,
  type BackupBlobs,
  type Snapshot,
  type SnapshotSource,
} from "@/lib/hub/backup";
import { createHubStore } from "@/lib/hub/store";
import { daylioPath } from "@/shared/collector-contract";

const run = promisify(execFile);
const RESTORE = join(__dirname, "../../../scripts/hub-restore.ts");

async function restore(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [RESTORE, ...args]);
    return { code: 0, stdout, stderr };
  } catch (e) {
    const failed = e as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

const RESTORE_SOURCE = readFileSync(RESTORE, "utf8");

/** The per-table column lists written in scripts/hub-restore.ts, with its two shared constants resolved. */
function restoreColumns(): Record<string, string[]> {
  const block = RESTORE_SOURCE.slice(RESTORE_SOURCE.indexOf("const NEWS_COLUMNS"), RESTORE_SOURCE.indexOf("} as const"));
  const named: Record<string, string> = { NEWS_ISSUE_COLUMNS, NEWS_SHARED_COLUMNS };
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/(news_\w+):\s*(?:"([^"]+)"|(NEWS_\w+))/g)) out[m[1]] = (m[2] ?? named[m[3]]).split(",");
  return out;
}

const emptyNews = { sources: [], runs: [], issues: [], shared: [], clusters: [], companies: [], topics: [], stories: [] };

const emptySource: SnapshotSource = {
  items: async () => [],
  comments: async () => [],
  hubState: async () => ({}),
  memoFiles: async () => [],
  nowPlace: async () => [],
  nowPlacePrivacy: async () => [],
  nowBake: async () => [],
  collectorPhoto: async () => [],
  collectorDaylioExport: async () => [],
  itemsHistory: async () => [],
  auditLog: async () => [],
  news: async () => emptyNews,
  aiUsage: async () => [],
  ideaSettings: async () => [],
  ideaReviews: async () => [],
  ideaSources: async () => [],
  ideaResurface: async () => [],
  ideaRecordings: async () => [],
};

const IDEA_KEYS = ["aiUsage", "ideaSettings", "ideaReviews", "ideaSources", "ideaResurface", "ideaRecordings"] as const;

function fakeBlobs(initial: string[]) {
  const files = new Map<string, string>(initial.map((p) => [p, "{}"]));
  const uploadedAt = new Map<string, string>(initial.map((p) => [p, `${p.slice(-15, -5)}T03:00:00.000Z`]));
  const deleted: string[] = [];
  // Ignores the prefix on purpose, so the test proves the pruning filter itself never reaches outside hub-backups/.
  const blobs: BackupBlobs = {
    async put(pathname, body) {
      files.set(pathname, body);
      uploadedAt.set(pathname, JSON.parse(body).takenAt);
    },
    async list() {
      return [...files.keys()].map((pathname) => ({ pathname, uploadedAt: uploadedAt.get(pathname)! }));
    },
    async del(pathnames) {
      for (const p of pathnames) {
        deleted.push(p);
        files.delete(p);
      }
    },
  };
  return { files, deleted, blobs };
}

const dayPath = (daysBefore: number) => backupPath(new Date(Date.UTC(2026, 10, 5) - daysBefore * 86_400_000));

describe("snapshot", () => {
  it("holds every table, the now place, privacy, bake, collector, history and audit tables included", async () => {
    const place = { id: 7, city: "Kent", region: "Ohio", country: "United States", private: true, timeZone: "America/New_York", updatedAt: "2026-11-01T00:00:00Z" };
    const bake = { id: 3, name: "Sourdough", photo: null, bakedAt: "2026-11-02T00:00:00Z" };
    const privacy = { id: 2, city: "Kent", region: "Ohio", country: "United States", private: true, createdAt: "2026-11-01T01:00:00Z" };
    const version = { id: 4, itemId: "i1", title: "old", description: "old text", changedBy: "service_role", changedAt: "2026-11-03T00:00:00Z" };
    const photo = { id: 5, path: "collector/123.jpg", assetId: "123", takenAt: "2026-11-01T10:00:00Z", width: 4000, height: 3000, hidden: true, createdAt: "2026-11-01T10:05:00Z" };
    const daylio = { id: 6, path: "exports/1762000000000-120-daylio.csv", filename: "daylio.csv", sizeBytes: 120, modifiedAt: "2025-11-01T12:26:40Z", createdAt: "2026-11-02T00:00:00Z" };
    const audit = { id: 9, actor: "agent:x", action: "update", itemId: "i1", detail: { fields: ["title"] }, at: "2026-11-03T00:00:00Z" };
    const shot = await snapshot(
      {
        ...emptySource,
        hubState: async () => ({ "reminded:x": "2026-11-05T10:00:00" }),
        nowPlace: async () => [place],
        nowPlacePrivacy: async () => [privacy],
        nowBake: async () => [bake],
        collectorPhoto: async () => [photo],
        collectorDaylioExport: async () => [daylio],
        itemsHistory: async () => [version],
        auditLog: async () => [audit],
      },
      new Date("2026-11-05T03:00:00Z"),
    );
    expect(shot).toEqual({
      items: [],
      comments: [],
      hubState: { "reminded:x": "2026-11-05T10:00:00" },
      memoFiles: [],
      nowPlace: [place],
      nowPlacePrivacy: [privacy],
      nowBake: [bake],
      collectorPhoto: [photo],
      collectorDaylioExport: [daylio],
      itemsHistory: [version],
      auditLog: [audit],
      news: emptyNews,
      aiUsage: [],
      ideaSettings: [],
      ideaReviews: [],
      ideaSources: [],
      ideaResurface: [],
      ideaRecordings: [],
      takenAt: "2026-11-05T03:00:00.000Z",
    });
  });

  it("holds the six Ideas Lab tables", async () => {
    const usage = { id: 1, feature: "ideas", model: "m", inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5, webSearches: 1, costUsd: 0.25, itemId: "i1", purpose: "review", at: "2026-11-03T00:00:00Z" };
    const settings = { itemId: "i1", enrolled: true, scheduleFrom: "2026-11-03", remindersStoppedAt: null, noWebSearch: false, reviewStatus: "done", reviewRequestedAt: null, reviewNote: null, reviewAttempts: 1, reviewClaimedAt: null, lastError: null, movedFromInbox: false, mentionCount: 1, updatedAt: "2026-11-03T00:00:00Z" };
    const review = { id: 2, itemId: "i1", version: 1, review: { summary: "s" }, model: "m", promptVersion: "v1", note: null, costUsd: 0.25, createdAt: "2026-11-03T00:00:00Z" };
    const source = { sourceItemId: "i0", kind: "capture", status: "done", ideaItemIds: ["i1"], quotes: [], attempts: 1, model: "m", lastError: null, createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z" };
    const resurface = { id: 3, itemId: "i1", step: 1, dueDate: "2026-11-10", eventDate: null, googleEventId: null, status: "planned", createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z" };
    const recording = { file: "memo.txt", recorded: "2026-11-02T00:00:00Z", transcript: "hi", status: "pending", attempts: 0, ideaItemIds: [], quotes: [], model: null, lastError: null, createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z" };
    const shot = await snapshot({
      ...emptySource,
      aiUsage: async () => [usage],
      ideaSettings: async () => [settings],
      ideaReviews: async () => [review],
      ideaSources: async () => [source],
      ideaResurface: async () => [resurface],
      ideaRecordings: async () => [recording],
    });
    expect(shot).toMatchObject({
      aiUsage: [usage],
      ideaSettings: [settings],
      ideaReviews: [review],
      ideaSources: [source],
      ideaResurface: [resurface],
      ideaRecordings: [recording],
    });
  });
});

describe("news snapshot", () => {
  it("reads every news table and asks for no clean_text or fetched_text", async () => {
    const selects: Record<string, string> = {};
    const client = {
      from(table: string) {
        const q = {
          select(columns: string) {
            selects[table] = columns;
            return q;
          },
          order: () => q,
          limit: () => q,
          gt: () => q,
          then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
        };
        return q;
      },
    };
    const news = await createSnapshotSource(client as never).news();
    expect(Object.keys(news).sort()).toEqual(Object.keys(emptyNews).sort());
    expect(Object.keys(selects).sort()).toEqual(
      ["news_clusters", "news_companies", "news_extraction_runs", "news_issues", "news_shared", "news_sources", "news_stories", "news_topics"],
    );
    expect(selects.news_issues).not.toContain("clean_text");
    expect(selects.news_shared).not.toContain("fetched_text");
    expect(selects.news_issues).toContain("raw_path");
  });
});

describe("news snapshot before 0009", () => {
  function failingClient(error: { code: string; message: string }) {
    return {
      from() {
        const q = {
          select: () => q,
          order: () => q,
          limit: () => q,
          gt: () => q,
          then: (resolve: (v: { data: null; error: typeof error }) => void) => resolve({ data: null, error }),
        };
        return q;
      },
    };
  }

  it("returns an empty news section when the news tables are missing", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const news = await createSnapshotSource(failingClient({ code, message: "missing" }) as never).news();
      expect(news).toEqual(emptyNews);
    }
  });

  it("still fails on any other error", async () => {
    await expect(createSnapshotSource(failingClient({ code: "57014", message: "timeout" }) as never).news()).rejects.toMatchObject({ code: "57014" });
  });
});

describe("restore column lists", () => {
  it("uses the same issue and shared column lists as the snapshot, and lists all eight news tables", () => {
    const cols = restoreColumns();
    expect(RESTORE_SOURCE).toContain(NEWS_ISSUE_COLUMNS);
    expect(RESTORE_SOURCE).toContain(NEWS_SHARED_COLUMNS);
    expect(cols.news_issues).toEqual(NEWS_ISSUE_COLUMNS.split(","));
    expect(cols.news_shared).toEqual(NEWS_SHARED_COLUMNS.split(","));
    expect(Object.keys(cols)).toHaveLength(8);
  });
});

describe("runBackup", () => {
  it("writes the snapshot as JSON at hub-backups/YYYY-MM-DD.json in UTC", async () => {
    const { files, blobs } = fakeBlobs([]);
    const result = await runBackup({ source: emptySource, blobs, now: new Date("2026-11-05T23:30:00-07:00") });
    expect(result.path).toBe("hub-backups/2026-11-06.json");
    expect(result.newestAt).toBe("2026-11-06T06:30:00.000Z");
    expect(JSON.parse(files.get("hub-backups/2026-11-06.json")!).takenAt).toBe("2026-11-06T06:30:00.000Z");
  });

  it("keeps exactly the newest 30 backups and never deletes outside hub-backups/", async () => {
    const outside = ["hub-backups-old/2020-01-01.json", "photos/2020-01-01.json", "2020-01-01.json", "hub-backups/notes.txt"];
    const old = Array.from({ length: 35 }, (_, i) => dayPath(i + 1));
    const { files, deleted, blobs } = fakeBlobs([...old, ...outside]);

    const result = await runBackup({ source: emptySource, blobs, now: new Date("2026-11-05T03:00:00Z") });

    const kept = [...files.keys()].filter((p) => /^hub-backups\/\d{4}-\d{2}-\d{2}\.json$/.test(p)).sort().reverse();
    expect(kept).toHaveLength(KEEP_BACKUPS);
    expect(kept[0]).toBe("hub-backups/2026-11-05.json");
    expect(kept.at(-1)).toBe(dayPath(29));
    expect(result.pruned.sort()).toEqual(old.slice(29).sort());
    expect(deleted.every((p) => p.startsWith(BACKUP_PREFIX))).toBe(true);
    for (const p of outside) expect(files.has(p)).toBe(true);
  });

  it("overwrites today's file on a second run instead of pruning it", async () => {
    const { files, blobs } = fakeBlobs([]);
    await runBackup({ source: emptySource, blobs, now: new Date("2026-11-05T03:00:00Z") });
    const second = await runBackup({ source: emptySource, blobs, now: new Date("2026-11-05T09:00:00Z") });
    expect(second.pruned).toEqual([]);
    expect(JSON.parse(files.get("hub-backups/2026-11-05.json")!).takenAt).toBe("2026-11-05T09:00:00.000Z");
  });
});

describe("hub-restore guards", () => {
  it("refuses a target that is not local without the live flag, before connecting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hub-restore-"));
    const file = join(dir, "snap.json");
    await writeFile(file, JSON.stringify(await snapshot(emptySource)));
    const result = await restore([file, "--target", "postgresql://postgres:x@db.example.com:5432/postgres"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--i-know-this-is-live");
  });

  it("needs a file and a target", async () => {
    expect((await restore([])).code).not.toBe(0);
  });
});

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=<API_URL> HUB_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// HUB_TEST_PG_URL=postgresql://postgres:postgres@127.0.0.1:<db port> (the same stack's Postgres; a full postgres HUB_TEST_DB_URL also works).
// The round trip restores into a scratch database it creates and drops in the local Postgres, never the shared one.
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const dbUrlVar = process.env.HUB_TEST_DB_URL ?? "";
// No default port: a guessed 54322 once reached another worktree's stack.
const pgUrl = (process.env.HUB_TEST_PG_URL || (/^postgres(ql)?:\/\//.test(dbUrlVar) ? dbUrlVar : "")).replace(/\/+$/, "");
const enabled = Boolean(dbUrlVar) && Boolean(pgUrl);
// The scratch database name is appended, so any database already in the URL is dropped.
const LOCAL_DB = pgUrl ? pgUrl.replace(/^(postgres(?:ql)?:\/\/[^/]+).*$/, "$1") : "";
const isLocal = (url: string) => /^(127\.0\.0\.1|localhost)$/.test(new URL(url || "http://invalid").hostname);
if (enabled && !isLocal(apiUrl)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}
if (enabled && !isLocal(pgUrl)) {
  throw new Error("HUB_TEST_PG_URL must be a local Postgres (127.0.0.1 or localhost)");
}

// Just enough of Supabase's auth schema for the hub migrations to apply in a bare database.
const AUTH_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select null::uuid';
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (bucket_id text, name text);
`;

describe.skipIf(!enabled)("backup round trip against local Supabase", () => {
  const scratch = `hub_restore_${randomUUID().replace(/-/g, "")}`;
  const scratchUrl = `${LOCAL_DB}/${scratch}`;
  const oldScratch = `${scratch}_old`;
  let file = "";
  let shot: Snapshot;

  async function withDb<T>(url: string, fn: (db: pg.Client) => Promise<T>): Promise<T> {
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
      return await fn(db);
    } finally {
      await db.end();
    }
  }

  async function createScratch(name: string): Promise<void> {
    await withDb(`${LOCAL_DB}/postgres`, (db) => db.query(`create database ${name}`));
    const migrations = await Promise.all(
      ["0002_hub.sql", "0003_hub_memo.sql", "0005_now.sql", "0006_hub_history.sql", "0007_collector.sql", "0008_ideas_lab.sql", "0009_news.sql"].map((m) =>
        readFile(join(__dirname, "../../../supabase/migrations", m), "utf8"),
      ),
    );
    await withDb(`${LOCAL_DB}/${name}`, async (db) => {
      await db.query(AUTH_STUB);
      // Public buckets made before 0007 runs, so the test below proves 0007 turns them private.
      await db.query("insert into storage.buckets (id, name, public) values ('photos', 'photos', true), ('daylio', 'daylio', true)");
      // A bare database has no pg_cron or Vault, so skip the job schedule and the body checks of the Vault functions.
      await db.query("set check_function_bodies = off");
      for (const sql of migrations) await db.query(sql.replace(/^select cron\.schedule\(.*$/m, ""));
    });
  }

  beforeAll(async () => {
    const client = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = createHubStore(client, { kind: "worker", runId: "backup-test" });
    const older = await store.addItem({ title: "backup survivor", source: "test", due: { date: "2026-11-05", time: "09:30:00" } });
    const newer = await store.addItem({ title: "backup duplicate", source: "test" });
    await store.addComment(older.id, "backup comment");
    await store.archive(newer.id, "merged", older.id, "merged in the backup test");
    await store.updateItem(older.id, { description: "backup rewrite" });
    await store.setHubState(`reminded:${older.id}`, "2026-11-05T09:30:00");
    const place = await client.from("now_place").insert([
      { city: "Backupville", region: "Ohio", country: "United States", private: true, time_zone: "America/New_York" },
      { city: null, region: "Ohio", country: "United States", private: true },
    ]);
    const bake = await client.from("now_bake").insert({ name: "backup loaf", photo: "/misc/Mason_traveling.webp" });
    const privacy = await client.from("now_place_privacy").insert({ city: "Backupville", region: "Ohio", country: "United States", private: true });
    if (place.error || bake.error || privacy.error) throw place.error ?? bake.error ?? privacy.error;
    const assetId = `backup${randomUUID().slice(0, 8)}`;
    const modifiedMs = Date.parse("2026-11-02T08:00:00.123Z");
    const photo = await client.from("collector_photo").insert({
      path: `collector/${assetId}.jpg`, asset_id: assetId, taken_at: "2026-11-01T10:00:00Z", width: 4000, height: 3000, hidden: true,
    });
    const daylioName = `backup daylio ${assetId}.csv`;
    const daylio = await client.from("collector_daylio_export").insert({
      path: daylioPath(daylioName, 120, modifiedMs), filename: daylioName, size_bytes: 120, modified_at: new Date(modifiedMs).toISOString(),
    });
    if (photo.error || daylio.error) throw photo.error ?? daylio.error;

    const tag = randomUUID();
    const run = await client.from("news_extraction_runs").insert({ model: "test", prompt_version: "t1", kind: "daily" }).select("id").single();
    if (run.error) throw run.error;
    const issue = await client
      .from("news_issues")
      .insert({ source_id: "rundown-ai", message_id: `backup-${tag}`, subject: "synthetic", raw_path: `news/raw/${tag}.eml`, clean_text: "SECRET BODY", status: "done" })
      .select("id")
      .single();
    const cluster = await client.from("news_clusters").insert({ first_date: "2026-11-04" }).select("id").single();
    const topic = await client.from("news_topics").upsert({ slug: "backup-topic", name: "Backup topic" });
    if (issue.error || cluster.error || topic.error) throw issue.error ?? cluster.error ?? topic.error;
    const stories = await client.from("news_stories").insert(
      [4, 5].map((day) => ({
        run_id: run.data.id,
        issue_id: issue.data.id,
        source_id: "rundown-ai",
        story_date: `2026-11-0${day}`,
        headline: `backup story ${day}`,
        kind: "news",
        sentiment: 1,
        topics: ["backup-topic"],
        cluster_id: cluster.data.id,
      })),
    );
    if (stories.error) throw stories.error;
    const current = await client.from("news_issues").update({ current_run_id: run.data.id }).eq("id", issue.data.id);
    if (current.error) throw current.error;
    // A capture filed straight to Ideas fires the live intake trigger; a restore that fired it again would hit a duplicate key.
    const idea = await store.addItem({ title: "backup idea", source: "capture", list: "ideas" });
    const recordingFile = `backup-${randomUUID()}.txt`;
    const ideaWrites = await Promise.all([
      client.from("idea_reviews").insert({ item_id: idea.id, version: 1, review: { summary: "backup" }, model: "test", prompt_version: "v1", cost_usd: 0.25 }),
      client.from("ai_usage").insert({ feature: "ideas", model: "test", input_tokens: 100, cost_usd: 0.25, item_id: idea.id, purpose: "review" }),
      client.from("idea_sources").insert({ source_item_id: older.id, kind: "memo", status: "done", idea_item_ids: [idea.id], quotes: [{ text: "backup" }] }),
      client.from("idea_resurface").insert({ item_id: idea.id, step: 1, due_date: "2026-12-01", event_date: "2026-12-01", google_event_id: "evt-backup", status: "sent" }),
      client.from("idea_recordings").insert({ file: recordingFile, recorded: "2026-11-05T09:30:00Z", transcript: "backup memo" }),
    ]);
    const failed = ideaWrites.find((w) => w.error);
    if (failed) throw failed.error;

    shot = await snapshot(createSnapshotSource(client));
    file = join(await mkdtemp(join(tmpdir(), "hub-backup-")), "snapshot.json");
    await writeFile(file, JSON.stringify(shot));

    for (const name of [scratch, oldScratch]) await createScratch(name);
  }, 60_000);

  afterAll(async () => {
    for (const name of [scratch, oldScratch]) {
      await withDb(`${LOCAL_DB}/postgres`, (db) => db.query(`drop database if exists ${name} with (force)`));
    }
  });

  it("restores a snapshot into an empty database with equal row counts and ids", async () => {
    expect(shot.items.length).toBeGreaterThanOrEqual(2);
    const result = await restore([file, "--target", scratchUrl]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);

    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    await withDb(scratchUrl, async (db) => {
      const items = (await db.query("select id, state, merged_into, archived_reason, due_time::text from public.items")).rows;
      const comments = (await db.query("select id from public.comments")).rows;
      const state = (await db.query("select key as id from public.hub_state")).rows;
      const memoFiles = (await db.query("select file as id from public.memo_files")).rows;
      expect(ids(items)).toEqual(shot.items.map((i) => i.id).sort());
      expect(ids(comments)).toEqual(shot.comments.map((c) => c.id).sort());
      expect(ids(state)).toEqual(Object.keys(shot.hubState).sort());
      expect(ids(memoFiles)).toEqual(shot.memoFiles.map((m) => m.file).sort());
      const nowPlace = (await db.query("select id::int, city, private, time_zone from public.now_place order by id")).rows;
      const nowBake = (await db.query("select id::int, name, photo from public.now_bake order by id")).rows;
      expect(shot.nowPlace.length).toBeGreaterThan(0);
      expect(shot.nowBake.length).toBeGreaterThan(0);
      expect(shot.nowPlacePrivacy.length).toBeGreaterThan(0);
      const privacyRows = (await db.query("select id::int, city, private from public.now_place_privacy order by id")).rows;
      expect(privacyRows).toEqual(shot.nowPlacePrivacy.map((p) => ({ id: Number(p.id), city: p.city, private: p.private })));
      expect(nowPlace).toEqual(shot.nowPlace.map((p) => ({ id: Number(p.id), city: p.city, private: p.private, time_zone: p.timeZone })));
      expect(shot.nowPlace.some((p) => p.timeZone === "America/New_York")).toBe(true);
      expect(shot.nowPlace.some((p) => p.city === null && p.private)).toBe(true);
      expect(shot.collectorPhoto.some((p) => p.hidden)).toBe(true);
      expect(shot.collectorDaylioExport.length).toBeGreaterThan(0);
      const photos = (await db.query("select id::int, path, hidden, taken_at from public.collector_photo order by id")).rows;
      expect(photos.map((p) => ({ ...p, taken_at: p.taken_at.toISOString() }))).toEqual(
        shot.collectorPhoto.map((p) => ({ id: Number(p.id), path: p.path, hidden: p.hidden, taken_at: new Date(p.takenAt).toISOString() })),
      );
      const exports = (await db.query("select id::int, path, size_bytes::int from public.collector_daylio_export order by id")).rows;
      expect(exports).toEqual(shot.collectorDaylioExport.map((d) => ({ id: Number(d.id), path: d.path, size_bytes: Number(d.sizeBytes) })));
      const nextPhoto = (
        await db.query("insert into public.collector_photo (path, asset_id, taken_at, width, height) values ('collector/after.jpg', 'after', now(), 1, 1) returning id::int")
      ).rows[0];
      expect(nextPhoto.id).toBeGreaterThan(Math.max(...shot.collectorPhoto.map((p) => Number(p.id))));
      expect(nowBake).toEqual(shot.nowBake.map((b) => ({ id: Number(b.id), name: b.name, photo: b.photo })));
      // The identity sequence moved past the restored ids, so the next bake gets a fresh one.
      const next = (await db.query("insert into public.now_bake (name) values ('after restore') returning id::int")).rows[0];
      expect(next.id).toBeGreaterThan(Math.max(...shot.nowBake.map((b) => Number(b.id))));

      const history = (await db.query("select id::int, item_id, title from public.items_history order by id")).rows;
      expect(shot.itemsHistory.some((v) => v.title === "backup survivor")).toBe(true);
      expect(history).toEqual(shot.itemsHistory.map((v) => ({ id: Number(v.id), item_id: v.itemId, title: v.title })));
      const audit = (await db.query("select id::int, actor, action from public.audit_log order by id")).rows;
      expect(shot.auditLog.length).toBeGreaterThan(0);
      expect(audit).toEqual(shot.auditLog.map((a) => ({ id: Number(a.id), actor: a.actor, action: a.action })));
      const nextAudit = (await db.query("insert into public.audit_log (actor, action) values ('test', 'after restore') returning id::int")).rows[0];
      expect(nextAudit.id).toBeGreaterThan(Math.max(...shot.auditLog.map((a) => Number(a.id))));

      const merged = shot.items.find((i) => i.title === "backup duplicate" && i.state === "archived")!;
      expect(items.find((r) => r.id === merged.id)).toMatchObject({ merged_into: merged.mergedInto, archived_reason: "merged" });

      for (const key of IDEA_KEYS) expect(shot[key].length, key).toBeGreaterThan(0);
      const numericIds = async (table: string) => (await db.query(`select id::int from public.${table} order by id`)).rows.map((r) => r.id);
      expect(await numericIds("ai_usage")).toEqual(shot.aiUsage.map((u) => Number(u.id)));
      expect(await numericIds("idea_reviews")).toEqual(shot.ideaReviews.map((r) => Number(r.id)));
      expect(await numericIds("idea_resurface")).toEqual(shot.ideaResurface.map((r) => Number(r.id)));
      const keys = async (sql: string) => (await db.query(sql)).rows.map((r) => r.k).sort();
      expect(await keys("select item_id as k from public.idea_settings")).toEqual(shot.ideaSettings.map((s) => s.itemId).sort());
      expect(await keys("select source_item_id as k from public.idea_sources")).toEqual(shot.ideaSources.map((s) => s.sourceItemId).sort());
      expect(await keys("select file as k from public.idea_recordings")).toEqual(shot.ideaRecordings.map((r) => r.file).sort());

      const review = shot.ideaReviews.find((r) => r.model === "test")!;
      const restoredReview = (await db.query("select version, review, cost_usd::float as cost from public.idea_reviews where id = $1", [review.id])).rows[0];
      expect(restoredReview).toEqual({ version: review.version, review: review.review, cost: Number(review.costUsd) });
      const source = shot.ideaSources.find((s) => s.kind === "memo" && s.quotes && JSON.stringify(s.quotes).includes("backup"))!;
      const restoredSource = (await db.query("select idea_item_ids, quotes from public.idea_sources where source_item_id = $1", [source.sourceItemId])).rows[0];
      expect(restoredSource).toEqual({ idea_item_ids: source.ideaItemIds, quotes: source.quotes });
      const recording = shot.ideaRecordings.find((r) => r.transcript === "backup memo")!;
      const restoredRecording = (await db.query("select recorded, transcript from public.idea_recordings where file = $1", [recording.file])).rows[0];
      expect(restoredRecording.recorded.toISOString()).toBe(new Date(recording.recorded).toISOString());
      expect(restoredRecording.transcript).toBe("backup memo");

      const freshRow: Record<string, string> = {
        ai_usage: "insert into public.ai_usage (feature, model, cost_usd, purpose) values ('ideas', 'after', 0, 'test') returning id::int",
        idea_reviews: `insert into public.idea_reviews (item_id, version, review, model, prompt_version, cost_usd) values ('${review.itemId}', 99, '{}', 'after', 'v1', 0) returning id::int`,
        idea_resurface: `insert into public.idea_resurface (item_id, step, due_date) values ('${review.itemId}', 3, '2027-01-01') returning id::int`,
      };
      for (const [table, sql] of Object.entries(freshRow)) {
        const restored = await numericIds(table);
        expect((await db.query(sql)).rows[0].id, table).toBeGreaterThan(Math.max(...restored));
      }
    });
  }, 60_000);

  it("restores an older snapshot that has no Ideas Lab tables", async () => {
    const old: Record<string, unknown> = { ...shot };
    for (const key of IDEA_KEYS) delete old[key];
    const oldFile = join(await mkdtemp(join(tmpdir(), "hub-backup-old-")), "snapshot.json");
    await writeFile(oldFile, JSON.stringify(old));
    const result = await restore([oldFile, "--target", `${LOCAL_DB}/${oldScratch}`]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    await withDb(`${LOCAL_DB}/${oldScratch}`, async (db) => {
      expect((await db.query("select count(*)::int as n from public.items")).rows[0].n).toBe(shot.items.length);
      expect((await db.query("select count(*)::int as n from public.idea_settings")).rows[0].n).toBe(0);
    });
  }, 60_000);

  it("restores the news tables without cleaned text, moves their sequences and rebuilds trends", async () => {
    expect(shot.news.stories.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(shot.news)).not.toContain("SECRET BODY");
    expect(shot.news.issues.every((i) => !("clean_text" in i))).toBe(true);
    expect(shot.news.shared.every((i) => !("fetched_text" in i))).toBe(true);
    await withDb(scratchUrl, async (db) => {
      const count = async (table: string) => (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n as number;
      expect(await count("news_stories")).toBe(shot.news.stories.length);
      expect(await count("news_issues")).toBe(shot.news.issues.length);
      expect(await count("news_clusters")).toBe(shot.news.clusters.length);
      expect(await count("news_extraction_runs")).toBe(shot.news.runs.length);
      expect(await count("news_sources")).toBe(shot.news.sources.length);
      const issue = (await db.query("select clean_text, raw_path from public.news_issues where subject = 'synthetic' limit 1")).rows[0];
      expect(issue).toMatchObject({ clean_text: "" });
      expect(issue.raw_path).toContain("news/raw/");
      const trends = (await db.query("select count(*)::int as n from public.news_trends_daily where key = 'backup-topic'")).rows[0].n;
      expect(trends).toBeGreaterThanOrEqual(2);
      const maxOf = (rows: Record<string, unknown>[]) => Math.max(0, ...rows.map((r) => Number(r.id)));
      const sequences = [
        ["news_extraction_runs", shot.news.runs],
        ["news_companies", shot.news.companies],
        ["news_clusters", shot.news.clusters],
        ["news_stories", shot.news.stories],
      ] as const;
      for (const [table, rows] of sequences) {
        const next = (await db.query(`select nextval(pg_get_serial_sequence('public.${table}', 'id'))::int as id`)).rows[0].id;
        expect(next, table).toBeGreaterThan(maxOf([...rows]));
      }
    });
  }, 60_000);

  it("restores every column of the news tables except the two long texts", async () => {
    await withDb(scratchUrl, async (db) => {
      const left = new Set(["clean_text", "fetched_text"]);
      for (const [table, listed] of Object.entries(restoreColumns())) {
        const actual = (
          await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table])
        ).rows.map((r) => r.column_name as string);
        expect([...listed].sort(), table).toEqual(actual.filter((c) => !left.has(c)).sort());
      }
    });
  }, 60_000);

  it("0007 makes photos and daylio buckets that already existed as public private, with its limits", async () => {
    await withDb(scratchUrl, async (db) => {
      const buckets = (await db.query("select id, public, file_size_limit::int, allowed_mime_types from storage.buckets order by id")).rows;
      expect(buckets).toEqual([
        { id: "daylio", public: false, file_size_limit: 26214400, allowed_mime_types: null },
        { id: "photos", public: false, file_size_limit: 26214400, allowed_mime_types: ["image/jpeg"] },
      ]);
    });
  });

  it("refuses to restore into a database whose items table is not empty", async () => {
    const result = await restore([file, "--target", scratchUrl]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("not empty");
  }, 60_000);
});
