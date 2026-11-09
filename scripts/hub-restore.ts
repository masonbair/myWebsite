// Usage and what a restore leaves out: docs/hub-setup.md, "Restore a backup".
import { readFile } from "node:fs/promises";
import pg from "pg";
import type { Snapshot } from "../lib/hub/backup";

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
    (s.aiUsage === undefined || Array.isArray(s.aiUsage)) &&
    (s.ideaSettings === undefined || Array.isArray(s.ideaSettings)) &&
    (s.ideaReviews === undefined || Array.isArray(s.ideaReviews)) &&
    (s.ideaSources === undefined || Array.isArray(s.ideaSources)) &&
    (s.ideaResurface === undefined || Array.isArray(s.ideaResurface)) &&
    (s.ideaRecordings === undefined || Array.isArray(s.ideaRecordings));
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

const AI_USAGE_SQL = `
  insert into public.ai_usage (id, feature, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
                               web_searches, cost_usd, item_id, purpose, at) overriding system value
  select id, feature, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
         web_searches, cost_usd, item_id, purpose, at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, feature text, model text, input_tokens int, cache_read_tokens int,
       cache_write_tokens int, output_tokens int, web_searches int, cost_usd numeric, item_id uuid, purpose text, at timestamptz)`;

const IDEA_SETTINGS_SQL = `
  insert into public.idea_settings (item_id, enrolled, schedule_from, reminders_stopped_at, no_web_search, review_status,
                                    review_requested_at, review_note, review_attempts, review_claimed_at, last_error,
                                    moved_from_inbox, mention_count, updated_at)
  select item_id, enrolled, schedule_from, reminders_stopped_at, no_web_search, review_status,
         review_requested_at, review_note, review_attempts, review_claimed_at, last_error,
         moved_from_inbox, mention_count, updated_at
  from jsonb_to_recordset($1::jsonb) as r(item_id uuid, enrolled boolean, schedule_from date, reminders_stopped_at timestamptz,
       no_web_search boolean, review_status text, review_requested_at timestamptz, review_note text, review_attempts int,
       review_claimed_at timestamptz, last_error text, moved_from_inbox boolean, mention_count int, updated_at timestamptz)`;

const IDEA_REVIEWS_SQL = `
  insert into public.idea_reviews (id, item_id, version, review, model, prompt_version, note, cost_usd, created_at)
  overriding system value
  select id, item_id, version, review, model, prompt_version, note, cost_usd, created_at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, item_id uuid, version int, review jsonb, model text, prompt_version text,
       note text, cost_usd numeric, created_at timestamptz)`;

const IDEA_SOURCES_SQL = `
  insert into public.idea_sources (source_item_id, kind, status, idea_item_ids, quotes, attempts, model, last_error,
                                   created_at, updated_at)
  select source_item_id, kind, status, idea_item_ids, quotes, attempts, model, last_error, created_at, updated_at
  from jsonb_to_recordset($1::jsonb) as r(source_item_id uuid, kind text, status text, idea_item_ids uuid[], quotes jsonb,
       attempts int, model text, last_error text, created_at timestamptz, updated_at timestamptz)`;

const IDEA_RESURFACE_SQL = `
  insert into public.idea_resurface (id, item_id, step, due_date, event_date, google_event_id, status, created_at, updated_at)
  overriding system value
  select id, item_id, step, due_date, event_date, google_event_id, status, created_at, updated_at
  from jsonb_to_recordset($1::jsonb) as r(id bigint, item_id uuid, step int, due_date date, event_date date,
       google_event_id text, status text, created_at timestamptz, updated_at timestamptz)`;

const IDEA_RECORDINGS_SQL = `
  insert into public.idea_recordings (file, recorded, transcript, status, attempts, idea_item_ids, quotes, model, last_error,
                                      created_at, updated_at)
  select file, recorded, transcript, status, attempts, idea_item_ids, quotes, model, last_error, created_at, updated_at
  from jsonb_to_recordset($1::jsonb) as r(file text, recorded timestamptz, transcript text, status text, attempts int,
       idea_item_ids uuid[], quotes jsonb, model text, last_error text, created_at timestamptz, updated_at timestamptz)`;

const syncIdentity = (table: string) =>
  `select setval(pg_get_serial_sequence('public.${table}', 'id'), coalesce((select max(id) from public.${table}), 0) + 1, false)`;

async function restore(snapshot: Snapshot, target: string): Promise<Record<string, number>> {
  const db = new pg.Client({ connectionString: target });
  await db.connect();
  try {
    await db.query("begin");
    // Replica mode skips the guard triggers: 0002's would refuse done items, claude labels and Mason's comments, and 0008's intake would queue restored items again.
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
    const aiUsage = (snapshot.aiUsage ?? []).map((u) => ({
      id: u.id,
      feature: u.feature,
      model: u.model,
      input_tokens: u.inputTokens,
      cache_read_tokens: u.cacheReadTokens,
      cache_write_tokens: u.cacheWriteTokens,
      output_tokens: u.outputTokens,
      web_searches: u.webSearches,
      cost_usd: u.costUsd,
      item_id: u.itemId,
      purpose: u.purpose,
      at: u.at,
    }));
    const ideaSettings = (snapshot.ideaSettings ?? []).map((s) => ({
      item_id: s.itemId,
      enrolled: s.enrolled,
      schedule_from: s.scheduleFrom,
      reminders_stopped_at: s.remindersStoppedAt,
      no_web_search: s.noWebSearch,
      review_status: s.reviewStatus,
      review_requested_at: s.reviewRequestedAt,
      review_note: s.reviewNote,
      review_attempts: s.reviewAttempts,
      review_claimed_at: s.reviewClaimedAt,
      last_error: s.lastError,
      moved_from_inbox: s.movedFromInbox,
      mention_count: s.mentionCount,
      updated_at: s.updatedAt,
    }));
    const ideaReviews = (snapshot.ideaReviews ?? []).map((r) => ({
      id: r.id,
      item_id: r.itemId,
      version: r.version,
      review: r.review,
      model: r.model,
      prompt_version: r.promptVersion,
      note: r.note,
      cost_usd: r.costUsd,
      created_at: r.createdAt,
    }));
    const ideaSources = (snapshot.ideaSources ?? []).map((s) => ({
      source_item_id: s.sourceItemId,
      kind: s.kind,
      status: s.status,
      idea_item_ids: s.ideaItemIds,
      quotes: s.quotes,
      attempts: s.attempts,
      model: s.model,
      last_error: s.lastError,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }));
    const ideaResurface = (snapshot.ideaResurface ?? []).map((r) => ({
      id: r.id,
      item_id: r.itemId,
      step: r.step,
      due_date: r.dueDate,
      event_date: r.eventDate,
      google_event_id: r.googleEventId,
      status: r.status,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
    const ideaRecordings = (snapshot.ideaRecordings ?? []).map((r) => ({
      file: r.file,
      recorded: r.recorded,
      transcript: r.transcript,
      status: r.status,
      attempts: r.attempts,
      idea_item_ids: r.ideaItemIds,
      quotes: r.quotes,
      model: r.model,
      last_error: r.lastError,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));
    await db.query(AI_USAGE_SQL, [JSON.stringify(aiUsage)]);
    await db.query(IDEA_SETTINGS_SQL, [JSON.stringify(ideaSettings)]);
    await db.query(IDEA_REVIEWS_SQL, [JSON.stringify(ideaReviews)]);
    await db.query(IDEA_SOURCES_SQL, [JSON.stringify(ideaSources)]);
    await db.query(IDEA_RESURFACE_SQL, [JSON.stringify(ideaResurface)]);
    await db.query(IDEA_RECORDINGS_SQL, [JSON.stringify(ideaRecordings)]);
    await db.query(syncIdentity("ai_usage"));
    await db.query(syncIdentity("idea_reviews"));
    await db.query(syncIdentity("idea_resurface"));
    await db.query("commit");
    return {
      items: items.length,
      comments: comments.length,
      hubState: Object.keys(snapshot.hubState).length,
      memoFiles: memoFiles.length,
      nowPlace: nowPlace.length,
      nowPlacePrivacy: nowPlacePrivacy.length,
      nowBake: nowBake.length,
      itemsHistory: itemsHistory.length,
      auditLog: auditLog.length,
      aiUsage: aiUsage.length,
      ideaSettings: ideaSettings.length,
      ideaReviews: ideaReviews.length,
      ideaSources: ideaSources.length,
      ideaResurface: ideaResurface.length,
      ideaRecordings: ideaRecordings.length,
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
