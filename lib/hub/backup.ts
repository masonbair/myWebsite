import type { SupabaseClient } from "@supabase/supabase-js";
import { del, list, put } from "@vercel/blob";
import { ITEM_URL_BASE } from "./store";
import type { ArchiveReason, Comment, Item, ItemVersion } from "./types";

export type BackupResult = { path: string; pruned: string[]; newestAt: string | null };

/** An item with the columns the app type leaves out, so a restore loses nothing. */
export type BackupItem = Item & { archivedReason: ArchiveReason | null; clientKey: string | null; completedAt: string | null };
export type BackupMemoFile = {
  file: string;
  recorded: string | null;
  device: string | null;
  itemId: string | null;
  acceptedAt: string | null;
};

export type BackupNowPlace = {
  id: number;
  city: string | null;
  region: string;
  country: string;
  private: boolean;
  timeZone: string | null;
  updatedAt: string;
};
export type BackupNowPlacePrivacy = {
  id: number;
  city: string;
  region: string;
  country: string;
  private: boolean;
  createdAt: string;
};
export type BackupNowBake = { id: number; name: string; photo: string | null; bakedAt: string };
export type BackupCollectorPhoto = {
  id: number;
  path: string;
  assetId: string;
  takenAt: string;
  width: number;
  height: number;
  hidden: boolean;
  createdAt: string;
};
export type BackupDaylioExport = { id: number; path: string; filename: string; sizeBytes: number; modifiedAt: string; createdAt: string };
export type BackupAuditEntry = { id: number; actor: string; action: string; itemId: string | null; detail: unknown; at: string };

type Row = Record<string, unknown>;

/** News tables as raw rows; the long texts (`clean_text`, `fetched_text`) are left out because Blob raw files rebuild them. */
export type BackupNews = {
  sources: Row[];
  runs: Row[];
  issues: Row[];
  shared: Row[];
  clusters: Row[];
  companies: Row[];
  topics: Row[];
  stories: Row[];
};

export const NEWS_ISSUE_COLUMNS =
  "id,source_id,message_id,subject,from_address,received_at,published_on,raw_path,public_url,status,attempts,next_attempt_at,claimed_at,last_error,current_run_id,created_at";
export const NEWS_SHARED_COLUMNS =
  "id,item_id,url,title,thin,status,attempts,next_attempt_at,claimed_at,last_error,current_run_id,created_at";

export type BackupAiUsage = {
  id: number;
  feature: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  webSearches: number;
  costUsd: number;
  itemId: string | null;
  purpose: string;
  at: string;
};
export type BackupIdeaSettings = {
  itemId: string;
  enrolled: boolean;
  scheduleFrom: string | null;
  remindersStoppedAt: string | null;
  noWebSearch: boolean;
  reviewStatus: string;
  reviewRequestedAt: string | null;
  reviewNote: string | null;
  reviewAttempts: number;
  reviewClaimedAt: string | null;
  lastError: string | null;
  movedFromInbox: boolean;
  mentionCount: number;
  updatedAt: string;
};
export type BackupIdeaReview = {
  id: number;
  itemId: string;
  version: number;
  review: unknown;
  model: string;
  promptVersion: string;
  note: string | null;
  costUsd: number;
  createdAt: string;
};
export type BackupIdeaSource = {
  sourceItemId: string;
  kind: string;
  status: string;
  ideaItemIds: string[];
  quotes: unknown;
  attempts: number;
  model: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
export type BackupIdeaResurface = {
  id: number;
  itemId: string;
  step: number;
  dueDate: string;
  eventDate: string | null;
  googleEventId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};
export type BackupIdeaRecording = {
  file: string;
  recorded: string;
  transcript: string;
  status: string;
  attempts: number;
  ideaItemIds: string[];
  quotes: unknown;
  model: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Snapshot = {
  items: BackupItem[];
  comments: Comment[];
  hubState: Record<string, unknown>;
  memoFiles: BackupMemoFile[];
  nowPlace: BackupNowPlace[];
  nowPlacePrivacy: BackupNowPlacePrivacy[];
  nowBake: BackupNowBake[];
  collectorPhoto: BackupCollectorPhoto[];
  collectorDaylioExport: BackupDaylioExport[];
  itemsHistory: ItemVersion[];
  auditLog: BackupAuditEntry[];
  news: BackupNews;
  aiUsage: BackupAiUsage[];
  ideaSettings: BackupIdeaSettings[];
  ideaReviews: BackupIdeaReview[];
  ideaSources: BackupIdeaSource[];
  ideaResurface: BackupIdeaResurface[];
  ideaRecordings: BackupIdeaRecording[];
  takenAt: string;
};

export interface SnapshotSource {
  items(): Promise<BackupItem[]>;
  comments(): Promise<Comment[]>;
  hubState(): Promise<Record<string, unknown>>;
  memoFiles(): Promise<BackupMemoFile[]>;
  nowPlace(): Promise<BackupNowPlace[]>;
  nowPlacePrivacy(): Promise<BackupNowPlacePrivacy[]>;
  nowBake(): Promise<BackupNowBake[]>;
  collectorPhoto(): Promise<BackupCollectorPhoto[]>;
  collectorDaylioExport(): Promise<BackupDaylioExport[]>;
  itemsHistory(): Promise<ItemVersion[]>;
  auditLog(): Promise<BackupAuditEntry[]>;
  news(): Promise<BackupNews>;
  aiUsage(): Promise<BackupAiUsage[]>;
  ideaSettings(): Promise<BackupIdeaSettings[]>;
  ideaReviews(): Promise<BackupIdeaReview[]>;
  ideaSources(): Promise<BackupIdeaSource[]>;
  ideaResurface(): Promise<BackupIdeaResurface[]>;
  ideaRecordings(): Promise<BackupIdeaRecording[]>;
}

/** The blob calls a backup needs, so tests can swap in memory. */
export interface BackupBlobs {
  put(pathname: string, body: string): Promise<void>;
  /** Every file under the prefix, with its upload time as an ISO string. */
  list(prefix: string): Promise<{ pathname: string; uploadedAt: string }[]>;
  del(pathnames: string[]): Promise<void>;
}

export const BACKUP_PREFIX = "hub-backups/";
export const KEEP_BACKUPS = 30;
const BACKUP_FILE = /^hub-backups\/\d{4}-\d{2}-\d{2}\.json$/;
const PAGE = 1000;

export async function snapshot(source: SnapshotSource, now: Date = new Date()): Promise<Snapshot> {
  // Items last: they are never deleted, so every item a comment or memo file points at is already there.
  const nowPlace = await source.nowPlace();
  const nowPlacePrivacy = await source.nowPlacePrivacy();
  const nowBake = await source.nowBake();
  const collectorPhoto = await source.collectorPhoto();
  const collectorDaylioExport = await source.collectorDaylioExport();
  const hubState = await source.hubState();
  const memoFiles = await source.memoFiles();
  const comments = await source.comments();
  const itemsHistory = await source.itemsHistory();
  const auditLog = await source.auditLog();
  const news = await source.news();
  const aiUsage = await source.aiUsage();
  const ideaSettings = await source.ideaSettings();
  const ideaReviews = await source.ideaReviews();
  const ideaSources = await source.ideaSources();
  const ideaResurface = await source.ideaResurface();
  const ideaRecordings = await source.ideaRecordings();
  const items = await source.items();
  return {
    items,
    comments,
    hubState,
    memoFiles,
    nowPlace,
    nowPlacePrivacy,
    nowBake,
    collectorPhoto,
    collectorDaylioExport,
    itemsHistory,
    auditLog,
    news,
    aiUsage,
    ideaSettings,
    ideaReviews,
    ideaSources,
    ideaResurface,
    ideaRecordings,
    takenAt: now.toISOString(),
  };
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

/** `newestAt` is the newest kept backup's upload time as the store reports it, so a write that silently failed shows up. */
export async function runBackup(deps: { source: SnapshotSource; blobs: BackupBlobs; now: Date }): Promise<BackupResult> {
  const path = backupPath(deps.now);
  await deps.blobs.put(path, JSON.stringify(await snapshot(deps.source, deps.now)));
  const files = (await deps.blobs.list(BACKUP_PREFIX)).filter((f) => BACKUP_FILE.test(f.pathname));
  const pruned = backupsToPrune(files.map((f) => f.pathname));
  if (pruned.length > 0) await deps.blobs.del(pruned);
  const kept = files.filter((f) => !pruned.includes(f.pathname)).map((f) => f.uploadedAt).sort();
  return { path, pruned, newestAt: kept.at(-1) ?? null };
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
  async function all<T extends Record<string, unknown>>(table: string, key: string, columns = "*"): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      let query = client.from(table).select(columns).order(key, { ascending: true }).limit(PAGE);
      const last = rows.at(-1);
      if (last) query = query.gt(key, last[key] as string);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data as unknown as T[]));
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
    async nowPlace() {
      const rows = await all<{
        id: number;
        city: string | null;
        region: string;
        country: string;
        private: boolean;
        time_zone: string | null;
        updated_at: string;
      }>("now_place", "id");
      return rows.map((r) => ({
        id: r.id,
        city: r.city,
        region: r.region,
        country: r.country,
        private: r.private,
        timeZone: r.time_zone,
        updatedAt: r.updated_at,
      }));
    },
    async nowPlacePrivacy() {
      const rows = await all<{ id: number; city: string; region: string; country: string; private: boolean; created_at: string }>(
        "now_place_privacy",
        "id",
      );
      return rows.map((r) => ({ id: r.id, city: r.city, region: r.region, country: r.country, private: r.private, createdAt: r.created_at }));
    },
    async nowBake() {
      const rows = await all<{ id: number; name: string; photo: string | null; baked_at: string }>("now_bake", "id");
      return rows.map((r) => ({ id: r.id, name: r.name, photo: r.photo, bakedAt: r.baked_at }));
    },
    async collectorPhoto() {
      const rows = await all<{
        id: number;
        path: string;
        asset_id: string;
        taken_at: string;
        width: number;
        height: number;
        hidden: boolean;
        created_at: string;
      }>("collector_photo", "id");
      return rows.map((r) => ({
        id: r.id,
        path: r.path,
        assetId: r.asset_id,
        takenAt: r.taken_at,
        width: r.width,
        height: r.height,
        hidden: r.hidden,
        createdAt: r.created_at,
      }));
    },
    async collectorDaylioExport() {
      const rows = await all<{ id: number; path: string; filename: string; size_bytes: number; modified_at: string; created_at: string }>(
        "collector_daylio_export",
        "id",
      );
      return rows.map((r) => ({
        id: r.id,
        path: r.path,
        filename: r.filename,
        sizeBytes: r.size_bytes,
        modifiedAt: r.modified_at,
        createdAt: r.created_at,
      }));
    },
    async itemsHistory() {
      const rows = await all<{ id: number; item_id: string; title: string; description: string; changed_by: string; changed_at: string }>(
        "items_history",
        "id",
      );
      return rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        title: r.title,
        description: r.description,
        changedBy: r.changed_by,
        changedAt: r.changed_at,
      }));
    },
    async auditLog() {
      const rows = await all<{ id: number; actor: string; action: string; item_id: string | null; detail: unknown; at: string }>(
        "audit_log",
        "id",
      );
      return rows.map((r) => ({ id: r.id, actor: r.actor, action: r.action, itemId: r.item_id, detail: r.detail, at: r.at }));
    },
    async news() {
      try {
        return await readNews();
      } catch (error) {
        // Deploying before 0009 is pushed must not break the nightly backup.
        if (isMissingTable(error)) return { sources: [], runs: [], issues: [], shared: [], clusters: [], companies: [], topics: [], stories: [] };
        throw error;
      }
    },
    async aiUsage() {
      const rows = await all<{
        id: number;
        feature: string;
        model: string;
        input_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        output_tokens: number;
        web_searches: number;
        cost_usd: number;
        item_id: string | null;
        purpose: string;
        at: string;
      }>("ai_usage", "id");
      return rows.map((r) => ({
        id: r.id,
        feature: r.feature,
        model: r.model,
        inputTokens: r.input_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
        outputTokens: r.output_tokens,
        webSearches: r.web_searches,
        costUsd: r.cost_usd,
        itemId: r.item_id,
        purpose: r.purpose,
        at: r.at,
      }));
    },
    async ideaSettings() {
      const rows = await all<{
        item_id: string;
        enrolled: boolean;
        schedule_from: string | null;
        reminders_stopped_at: string | null;
        no_web_search: boolean;
        review_status: string;
        review_requested_at: string | null;
        review_note: string | null;
        review_attempts: number;
        review_claimed_at: string | null;
        last_error: string | null;
        moved_from_inbox: boolean;
        mention_count: number;
        updated_at: string;
      }>("idea_settings", "item_id");
      return rows.map((r) => ({
        itemId: r.item_id,
        enrolled: r.enrolled,
        scheduleFrom: r.schedule_from,
        remindersStoppedAt: r.reminders_stopped_at,
        noWebSearch: r.no_web_search,
        reviewStatus: r.review_status,
        reviewRequestedAt: r.review_requested_at,
        reviewNote: r.review_note,
        reviewAttempts: r.review_attempts,
        reviewClaimedAt: r.review_claimed_at,
        lastError: r.last_error,
        movedFromInbox: r.moved_from_inbox,
        mentionCount: r.mention_count,
        updatedAt: r.updated_at,
      }));
    },
    async ideaReviews() {
      const rows = await all<{
        id: number;
        item_id: string;
        version: number;
        review: unknown;
        model: string;
        prompt_version: string;
        note: string | null;
        cost_usd: number;
        created_at: string;
      }>("idea_reviews", "id");
      return rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        version: r.version,
        review: r.review,
        model: r.model,
        promptVersion: r.prompt_version,
        note: r.note,
        costUsd: r.cost_usd,
        createdAt: r.created_at,
      }));
    },
    async ideaSources() {
      const rows = await all<{
        source_item_id: string;
        kind: string;
        status: string;
        idea_item_ids: string[];
        quotes: unknown;
        attempts: number;
        model: string | null;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }>("idea_sources", "source_item_id");
      return rows.map((r) => ({
        sourceItemId: r.source_item_id,
        kind: r.kind,
        status: r.status,
        ideaItemIds: r.idea_item_ids,
        quotes: r.quotes,
        attempts: r.attempts,
        model: r.model,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    async ideaResurface() {
      const rows = await all<{
        id: number;
        item_id: string;
        step: number;
        due_date: string;
        event_date: string | null;
        google_event_id: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      }>("idea_resurface", "id");
      return rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        step: r.step,
        dueDate: r.due_date,
        eventDate: r.event_date,
        googleEventId: r.google_event_id,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    async ideaRecordings() {
      const rows = await all<{
        file: string;
        recorded: string;
        transcript: string;
        status: string;
        attempts: number;
        idea_item_ids: string[];
        quotes: unknown;
        model: string | null;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }>("idea_recordings", "file");
      return rows.map((r) => ({
        file: r.file,
        recorded: r.recorded,
        transcript: r.transcript,
        status: r.status,
        attempts: r.attempts,
        ideaItemIds: r.idea_item_ids,
        quotes: r.quotes,
        model: r.model,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
  };

  async function readNews(): Promise<BackupNews> {
    // Children first: these tables are never deleted, so every parent a story points at is already there when it is read.
    const stories = await all<Row>("news_stories", "id");
    const shared = await all<Row>("news_shared", "id", NEWS_SHARED_COLUMNS);
    const issues = await all<Row>("news_issues", "id", NEWS_ISSUE_COLUMNS);
    const clusters = await all<Row>("news_clusters", "id");
    const companies = await all<Row>("news_companies", "id");
    const runs = await all<Row>("news_extraction_runs", "id");
    const topics = await all<Row>("news_topics", "slug");
    const sources = await all<Row>("news_sources", "id");
    return { sources, runs, issues, shared, clusters, companies, topics, stories };
  }
}

/** Postgres "undefined table" or PostgREST "table not in the schema cache". */
function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205";
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
      const files: { pathname: string; uploadedAt: string }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor });
        files.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: b.uploadedAt.toISOString() })));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return files;
    },
    async del(pathnames) {
      await del(pathnames);
    },
  };
}
