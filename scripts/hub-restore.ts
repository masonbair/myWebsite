// Usage and what a restore leaves out: docs/hub-setup.md, "Restore a backup".
import { readFile } from "node:fs/promises";
import pg from "pg";
import type { BackupNews, Snapshot } from "../lib/hub/backup";

const LIVE_FLAG = "--i-know-this-is-live";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

class RestoreError extends Error {}

function parseArgs(argv: string[]): { file: string; target: string; allowLive: boolean } {
  const targetAt = argv.indexOf("--target");
  const target = targetAt >= 0 ? argv[targetAt + 1] : undefined;
  const file = argv.find((arg, i) => !arg.startsWith("--") && (targetAt < 0 || i !== targetAt + 1));
  const allowLive = argv.includes(LIVE_FLAG);
  if (!file || !target) throw new RestoreError(`usage: node scripts/hub-restore.ts <file> --target <db-url> [${LIVE_FLAG}]`);
  return { file, target, allowLive };
}

function assertTargetAllowed(target: string, allowLive: boolean): void {
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    throw new RestoreError("--target must be a postgres URL");
  }
  if (!LOCAL_HOSTS.has(host) && !allowLive) {
    throw new RestoreError(`${host} is not a local database; pass ${LIVE_FLAG} to restore into it`);
  }
}

function assertSnapshot(value: unknown): asserts value is Snapshot {
  const s = value as Partial<Snapshot> | null;
  const ok =
    Array.isArray(s?.items) &&
    Array.isArray(s.comments) &&
    typeof s.hubState === "object" &&
    s.hubState !== null &&
    (s.memoFiles === undefined || Array.isArray(s.memoFiles)) &&
    (s.nowPlace === undefined || Array.isArray(s.nowPlace)) &&
    (s.nowPlacePrivacy === undefined || Array.isArray(s.nowPlacePrivacy)) &&
    (s.nowBake === undefined || Array.isArray(s.nowBake)) &&
    (s.itemsHistory === undefined || Array.isArray(s.itemsHistory)) &&
    (s.auditLog === undefined || Array.isArray(s.auditLog)) &&
    (s.news === undefined || (typeof s.news === "object" && s.news !== null));
  if (!ok) throw new RestoreError("the file is not a hub snapshot");
}

const ITEMS_SQL = `
  insert into public.items (id, title, description, labels, list, state, due_date, due_time, archived_reason,
                            merged_into, source, client_key, created_at, updated_at, completed_at)
  select id, title, description, labels, list, state, due_date, due_time, archived_reason,
         merged_into, source, client_key, created_at, updated_at, completed_at
  from jsonb_to_recordset($1::jsonb) as r(id uuid, title text, description text, labels text[], list text, state text,
       due_date date, due_time time, archived_reason text, merged_into uuid, source text, client_key text,
       created_at timestamptz, updated_at timestamptz, completed_at timestamptz)`;

const COMMENTS_SQL = `
  insert into public.comments (id, item_id, body, author, created_at)
  select id, item_id, body, author, created_at
  from jsonb_to_recordset($1::jsonb) as r(id uuid, item_id uuid, body text, author text, created_at timestamptz)`;

const HUB_STATE_SQL = `
  insert into public.hub_state (key, value)
  select key, value from jsonb_each($1::jsonb)`;

const MEMO_FILES_SQL = `
  insert into public.memo_files (file, recorded, device, item_id, accepted_at)
  select file, recorded, device, item_id, accepted_at
  from jsonb_to_recordset($1::jsonb) as r(file text, recorded timestamp, device text, item_id uuid, accepted_at timestamptz)`;

// Ids are kept so a later backup lines up, then each identity sequence moves past them so new rows never collide.
const NOW_PLACE_SQL = `
  insert into public.now_place (id, city, region, country, private, time_zone, updated_at)
  select id, city, region, country, private, time_zone, updated_at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, city text, region text, country text, private boolean, time_zone text,
       updated_at timestamptz)`;

const NOW_PLACE_PRIVACY_SQL = `
  insert into public.now_place_privacy (id, city, region, country, private, created_at)
  select id, city, region, country, private, created_at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, city text, region text, country text, private boolean, created_at timestamptz)`;

const NOW_BAKE_SQL = `
  insert into public.now_bake (id, name, photo, baked_at)
  select id, name, photo, baked_at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, name text, photo text, baked_at timestamptz)`;

const ITEMS_HISTORY_SQL = `
  insert into public.items_history (id, item_id, title, description, changed_by, changed_at)
  select id, item_id, title, description, changed_by, changed_at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, item_id uuid, title text, description text, changed_by text, changed_at timestamptz)`;

// audit_log ids are "generated always", so keeping them needs overriding system value.
const AUDIT_LOG_SQL = `
  insert into public.audit_log (id, actor, action, item_id, detail, at) overriding system value
  select id, actor, action, item_id, detail, at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, actor text, action text, item_id uuid, detail jsonb, at timestamptz)`;

const newsInsert = (table: string, columns: string, conflict = "") =>
  `insert into public.${table} (${columns}) select ${columns} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)${conflict}`;

const upsert = (key: string, columns: string) =>
  ` on conflict (${key}) do update set ${columns
    .split(",")
    .filter((c) => c !== key)
    .map((c) => `${c} = excluded.${c}`)
    .join(", ")}`;

// Same lists as NEWS_ISSUE_COLUMNS and NEWS_SHARED_COLUMNS in lib/hub/backup.ts; node cannot load that file's value imports.
const NEWS_ISSUE_COLUMNS =
  "id,source_id,message_id,subject,from_address,received_at,published_on,raw_path,public_url,status,attempts,next_attempt_at,claimed_at,last_error,current_run_id,created_at";
const NEWS_SHARED_COLUMNS = "id,item_id,url,title,thin,status,attempts,next_attempt_at,claimed_at,last_error,current_run_id,created_at";
const SOURCE_COLUMNS = "id,name,sender_addresses,sender_domains,homepage,archive_pattern,public,active";
const TOPIC_COLUMNS = "slug,name,active,created_at";
// clean_text and fetched_text are not in the backup, so they restore as '' and null; docs/hub-setup.md says how to rebuild them.
const NEWS_SQL: { table: string; sql: string; rows: (n: BackupNews) => unknown[] }[] = [
  { table: "news_sources", sql: newsInsert("news_sources", SOURCE_COLUMNS, upsert("id", SOURCE_COLUMNS)), rows: (n) => n.sources },
  { table: "news_extraction_runs", sql: newsInsert("news_extraction_runs", "id,model,prompt_version,kind,created_at"), rows: (n) => n.runs },
  { table: "news_issues", sql: newsInsert("news_issues", NEWS_ISSUE_COLUMNS), rows: (n) => n.issues },
  { table: "news_shared", sql: newsInsert("news_shared", NEWS_SHARED_COLUMNS), rows: (n) => n.shared },
  { table: "news_clusters", sql: newsInsert("news_clusters", "id,first_date,created_at"), rows: (n) => n.clusters },
  {
    table: "news_companies",
    sql: newsInsert("news_companies", "id,name,norm_name,ticker,exchange,ticker_verified,aliases,created_at"),
    rows: (n) => n.companies,
  },
  { table: "news_topics", sql: newsInsert("news_topics", TOPIC_COLUMNS, upsert("slug", TOPIC_COLUMNS)), rows: (n) => n.topics },
  {
    table: "news_stories",
    sql: newsInsert(
      "news_stories",
      "id,run_id,issue_id,shared_id,source_id,story_date,headline,kind,sentiment,topics,suggested_topic,company_ids,link,cluster_id,created_at",
    ),
    rows: (n) => n.stories,
  },
];

const syncIdentity = (table: string) =>
  `select setval(pg_get_serial_sequence('public.${table}', 'id'), coalesce((select max(id) from public.${table}), 0) + 1, false)`;

async function restore(snapshot: Snapshot, target: string): Promise<Record<string, number>> {
  const db = new pg.Client({ connectionString: target });
  await db.connect();
  try {
    await db.query("begin");
    // Replica mode skips the 0002 guard triggers, which would refuse done items, claude labels and Mason's comments.
    await db.query("set local session_replication_role = replica");
    await db.query("lock table public.items in exclusive mode");
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.items");
    if (rows[0].n > 0) throw new RestoreError(`the target items table is not empty (${rows[0].n} rows); restore only into an empty database`);

    const items = snapshot.items.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      labels: i.labels,
      list: i.list,
      state: i.state,
      due_date: i.due?.date ?? null,
      due_time: i.due?.time ?? null,
      archived_reason: i.archivedReason ?? null,
      merged_into: i.mergedInto,
      source: i.source,
      client_key: i.clientKey ?? null,
      created_at: i.createdAt,
      updated_at: i.updatedAt,
      completed_at: i.completedAt ?? null,
    }));
    const comments = snapshot.comments.map((c) => ({
      id: c.id,
      item_id: c.itemId,
      body: c.body,
      author: c.author,
      created_at: c.createdAt,
    }));
    const memoFiles = (snapshot.memoFiles ?? []).map((m) => ({
      file: m.file,
      recorded: m.recorded,
      device: m.device,
      item_id: m.itemId,
      accepted_at: m.acceptedAt,
    }));
    await db.query(ITEMS_SQL, [JSON.stringify(items)]);
    await db.query(COMMENTS_SQL, [JSON.stringify(comments)]);
    await db.query(HUB_STATE_SQL, [JSON.stringify(snapshot.hubState)]);
    const nowPlace = (snapshot.nowPlace ?? []).map((p) => ({
      id: p.id,
      city: p.city,
      region: p.region,
      country: p.country,
      private: p.private,
      time_zone: p.timeZone ?? null,
      updated_at: p.updatedAt,
    }));
    const nowPlacePrivacy = (snapshot.nowPlacePrivacy ?? []).map((p) => ({
      id: p.id,
      city: p.city,
      region: p.region,
      country: p.country,
      private: p.private,
      created_at: p.createdAt,
    }));
    const nowBake = (snapshot.nowBake ?? []).map((b) => ({ id: b.id, name: b.name, photo: b.photo, baked_at: b.bakedAt }));
    await db.query(MEMO_FILES_SQL, [JSON.stringify(memoFiles)]);
    await db.query(NOW_PLACE_SQL, [JSON.stringify(nowPlace)]);
    await db.query(NOW_PLACE_PRIVACY_SQL, [JSON.stringify(nowPlacePrivacy)]);
    await db.query(NOW_BAKE_SQL, [JSON.stringify(nowBake)]);
    await db.query(syncIdentity("now_place"));
    await db.query(syncIdentity("now_place_privacy"));
    await db.query(syncIdentity("now_bake"));
    const itemsHistory = (snapshot.itemsHistory ?? []).map((v) => ({
      id: v.id,
      item_id: v.itemId,
      title: v.title,
      description: v.description,
      changed_by: v.changedBy,
      changed_at: v.changedAt,
    }));
    const auditLog = (snapshot.auditLog ?? []).map((a) => ({
      id: a.id,
      actor: a.actor,
      action: a.action,
      item_id: a.itemId,
      detail: a.detail,
      at: a.at,
    }));
    await db.query(ITEMS_HISTORY_SQL, [JSON.stringify(itemsHistory)]);
    await db.query(AUDIT_LOG_SQL, [JSON.stringify(auditLog)]);
    await db.query(syncIdentity("items_history"));
    await db.query(syncIdentity("audit_log"));
    const news: BackupNews | undefined = snapshot.news;
    const newsCounts: Record<string, number> = {};
    if (news) {
      for (const { table, sql, rows: pick } of NEWS_SQL) {
        const rows = pick(news);
        if (rows.length > 0) await db.query(sql, [JSON.stringify(rows)]);
        newsCounts[table] = rows.length;
      }
      for (const table of ["news_extraction_runs", "news_companies", "news_clusters", "news_stories"]) await db.query(syncIdentity(table));
      // Trend tables are derived, so they are rebuilt from the restored stories instead of backed up.
      await db.query(
        `select public.news_refresh_trends(min(story_date), max(story_date)) from public.news_stories having count(*) > 0`,
      );
    }
    await db.query("commit");
    return {
      ...newsCounts,
      items: items.length,
      comments: comments.length,
      hubState: Object.keys(snapshot.hubState).length,
      memoFiles: memoFiles.length,
      nowPlace: nowPlace.length,
      nowPlacePrivacy: nowPlacePrivacy.length,
      nowBake: nowBake.length,
      itemsHistory: itemsHistory.length,
      auditLog: auditLog.length,
    };
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    await db.end();
  }
}

async function main(argv: string[]): Promise<number> {
  try {
    const { file, target, allowLive } = parseArgs(argv);
    assertTargetAllowed(target, allowLive);
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    assertSnapshot(parsed);
    const counts = await restore(parsed, target);
    console.log(`restored ${Object.entries(counts).map(([table, n]) => `${n} ${table}`).join(", ")} from ${parsed.takenAt}`);
    return 0;
  } catch (e) {
    console.error(e instanceof RestoreError ? e.message : `restore failed: ${(e as Error).message}`);
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
