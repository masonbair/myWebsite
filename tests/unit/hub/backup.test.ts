import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  backupPath,
  createSnapshotSource,
  runBackup,
  snapshot,
  type BackupBlobs,
  type Snapshot,
  type SnapshotSource,
} from "@/lib/hub/backup";
import { createHubStore } from "@/lib/hub/store";

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

const emptySource: SnapshotSource = {
  items: async () => [],
  comments: async () => [],
  hubState: async () => ({}),
  memoFiles: async () => [],
};

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
  it("holds every table plus empty now data until the now tables exist", async () => {
    const shot = await snapshot(
      { ...emptySource, hubState: async () => ({ "reminded:x": "2026-11-05T10:00:00" }) },
      new Date("2026-11-05T03:00:00Z"),
    );
    expect(shot).toEqual({
      items: [],
      comments: [],
      hubState: { "reminded:x": "2026-11-05T10:00:00" },
      memoFiles: [],
      nowPlace: [],
      nowBake: [],
      takenAt: "2026-11-05T03:00:00.000Z",
    });
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

// Run with: HUB_TEST_DB_URL=1 HUB_TEST_SUPABASE_URL=http://127.0.0.1:54321 HUB_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`).
// The round trip restores into a scratch database it creates and drops in the local Postgres, never the shared one.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

// Just enough of Supabase's auth schema for the hub migrations to apply in a bare database.
const AUTH_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select null::uuid';
`;

describe.skipIf(!enabled)("backup round trip against local Supabase", () => {
  const scratch = `hub_restore_${randomUUID().replace(/-/g, "")}`;
  const scratchUrl = `${LOCAL_DB}/${scratch}`;
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

  beforeAll(async () => {
    const client = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const store = createHubStore(client, { kind: "worker", runId: "backup-test" });
    const older = await store.addItem({ title: "backup survivor", source: "test", due: { date: "2026-11-05", time: "09:30:00" } });
    const newer = await store.addItem({ title: "backup duplicate", source: "test" });
    await store.addComment(older.id, "backup comment");
    await store.archive(newer.id, "merged", older.id, "merged in the backup test");
    await store.setHubState(`reminded:${older.id}`, "2026-11-05T09:30:00");

    shot = await snapshot(createSnapshotSource(client));
    file = join(await mkdtemp(join(tmpdir(), "hub-backup-")), "snapshot.json");
    await writeFile(file, JSON.stringify(shot));

    await withDb(`${LOCAL_DB}/postgres`, (db) => db.query(`create database ${scratch}`));
    const migrations = await Promise.all(
      ["0002_hub.sql", "0003_hub_memo.sql"].map((name) => readFile(join(__dirname, "../../../supabase/migrations", name), "utf8")),
    );
    await withDb(scratchUrl, async (db) => {
      await db.query(AUTH_STUB);
      for (const sql of migrations) await db.query(sql);
    });
  }, 60_000);

  afterAll(async () => {
    await withDb(`${LOCAL_DB}/postgres`, (db) => db.query(`drop database if exists ${scratch} with (force)`));
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

      const merged = shot.items.find((i) => i.title === "backup duplicate" && i.state === "archived")!;
      expect(items.find((r) => r.id === merged.id)).toMatchObject({ merged_into: merged.mergedInto, archived_reason: "merged" });
    });
  }, 60_000);

  it("refuses to restore into a database whose items table is not empty", async () => {
    const result = await restore([file, "--target", scratchUrl]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("not empty");
  }, 60_000);
});
