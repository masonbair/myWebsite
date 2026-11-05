import type { SupabaseClient } from "@supabase/supabase-js";
import { del, list, put } from "@vercel/blob";
import { ITEM_URL_BASE } from "./store";
import type { ArchiveReason, Comment, Item } from "./types";

/** An item with the columns the app type leaves out, so a restore loses nothing. */
export type BackupItem = Item & { archivedReason: ArchiveReason | null; clientKey: string | null; completedAt: string | null };
export type BackupMemoFile = {
  file: string;
  recorded: string | null;
  device: string | null;
  itemId: string | null;
  acceptedAt: string | null;
};

export type Snapshot = {
  items: BackupItem[];
  comments: Comment[];
  hubState: Record<string, unknown>;
  memoFiles: BackupMemoFile[];
  nowPlace: unknown[];
  nowBake: unknown[];
  takenAt: string;
};

export interface SnapshotSource {
  items(): Promise<BackupItem[]>;
  comments(): Promise<Comment[]>;
  hubState(): Promise<Record<string, unknown>>;
  memoFiles(): Promise<BackupMemoFile[]>;
}

/** The blob calls a backup needs, so tests can swap in memory. */
export interface BackupBlobs {
  put(pathname: string, body: string): Promise<void>;
  /** Every pathname under the prefix. */
  list(prefix: string): Promise<string[]>;
  del(pathnames: string[]): Promise<void>;
}

export const BACKUP_PREFIX = "hub-backups/";
export const KEEP_BACKUPS = 30;
const BACKUP_FILE = /^hub-backups\/\d{4}-\d{2}-\d{2}\.json$/;
const PAGE = 1000;

export async function snapshot(source: SnapshotSource, now: Date = new Date()): Promise<Snapshot> {
  // Items last: they are never deleted, so every item a comment or memo file points at is already there.
  const hubState = await source.hubState();
  const memoFiles = await source.memoFiles();
  const comments = await source.comments();
  const items = await source.items();
  return { items, comments, hubState, memoFiles, nowPlace: [], nowBake: [], takenAt: now.toISOString() };
}

export function backupPath(now: Date): string {
  return `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json`;
}

/** Older daily backup files beyond the newest `keep`; anything else under or outside the prefix is never chosen. */
export function backupsToPrune(pathnames: string[], keep = KEEP_BACKUPS): string[] {
  return pathnames
    .filter((p) => BACKUP_FILE.test(p))
    .sort()
    .reverse()
    .slice(keep);
}

export async function runBackup(deps: { source: SnapshotSource; blobs: BackupBlobs; now: Date }): Promise<{ path: string; pruned: string[] }> {
  const path = backupPath(deps.now);
  await deps.blobs.put(path, JSON.stringify(await snapshot(deps.source, deps.now)));
  const pruned = backupsToPrune(await deps.blobs.list(BACKUP_PREFIX));
  if (pruned.length > 0) await deps.blobs.del(pruned);
  return { path, pruned };
}

type ItemRow = {
  id: string;
  title: string;
  description: string;
  labels: string[];
  list: Item["list"];
  state: Item["state"];
  due_date: string | null;
  due_time: string | null;
  archived_reason: ArchiveReason | null;
  merged_into: string | null;
  source: string;
  client_key: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function toBackupItem(row: ItemRow): BackupItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    labels: row.labels,
    list: row.list,
    state: row.state,
    due: row.due_date ? { date: row.due_date, time: row.due_time } : null,
    mergedInto: row.merged_into,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: `${ITEM_URL_BASE}${row.id}`,
    archivedReason: row.archived_reason,
    clientKey: row.client_key,
    completedAt: row.completed_at,
  };
}

/** Reads whole tables through the service client, paging by key so rows written meanwhile never shift a page. */
export function createSnapshotSource(client: SupabaseClient): SnapshotSource {
  async function all<T extends Record<string, unknown>>(table: string, key: string): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      let query = client.from(table).select("*").order(key, { ascending: true }).limit(PAGE);
      const last = rows.at(-1);
      if (last) query = query.gt(key, last[key] as string);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data as T[]));
      if (data.length < PAGE) return rows;
    }
  }

  return {
    async items() {
      return (await all<ItemRow>("items", "id")).map(toBackupItem);
    },
    async comments() {
      const rows = await all<{ id: string; item_id: string; body: string; author: Comment["author"]; created_at: string }>("comments", "id");
      return rows.map((r) => ({ id: r.id, itemId: r.item_id, body: r.body, author: r.author, createdAt: r.created_at }));
    },
    async hubState() {
      const rows = await all<{ key: string; value: unknown }>("hub_state", "key");
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    async memoFiles() {
      const rows = await all<{
        file: string;
        recorded: string | null;
        device: string | null;
        item_id: string | null;
        accepted_at: string | null;
      }>("memo_files", "file");
      return rows.map((r) => ({ file: r.file, recorded: r.recorded, device: r.device, itemId: r.item_id, acceptedAt: r.accepted_at }));
    },
  };
}

/** The private Vercel Blob store, authenticated by the function's OIDC token plus BLOB_STORE_ID; no read-write token. */
export function vercelBlobs(): BackupBlobs {
  return {
    async put(pathname, body) {
      await put(pathname, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
    },
    async list(prefix) {
      const pathnames: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor });
        pathnames.push(...page.blobs.map((b) => b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return pathnames;
    },
    async del(pathnames) {
      await del(pathnames);
    },
  };
}
