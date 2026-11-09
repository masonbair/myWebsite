import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordUsage, type ClaudeUsage, type ModelId } from "@/lib/ai/claude";
import { auditActor } from "@/lib/hub/rules";
import { createHubStore } from "@/lib/hub/store";
import type { Actor, Comment, Item } from "@/lib/hub/types";
import { z } from "zod";
import {
  PROMPT_VERSION,
  SAVED_IDEA,
  type IdeaReview,
  type IdeaSettings,
  type MemoIdeas,
  type ReviewStatus,
  type SavedIdea,
  type SourceKind,
} from "./types";

/** The idea is no longer claimed by this run (a stale re-claim or Mason's change); its review must not be saved. */
export class ClaimLost extends Error {
  constructor(id: string) {
    super(`claim lost for ${id}`);
    this.name = "ClaimLost";
  }
}

export const IDEAS_ACTOR: Actor = { kind: "worker", runId: "ideas-lab" };
const MAX_FAILED_ATTEMPTS = 2;
const MAX_DETECT_ATTEMPTS = 3;
const OPEN_IDEAS_LIMIT = 200;
// idea_sources has no working status, so a claim is a fresh updated_at; longer than a whole run, shorter than the 15-minute cron gap.
const SOURCE_LEASE_MS = 10 * 60 * 1000;
const SOURCE_CANDIDATES = 20;

/** A claimed source; `saved` is the detection a failed earlier run already made, to file from instead of asking again. */
export type ClaimedSource = { itemId: string; kind: SourceKind; saved: { ideas: SavedIdea[]; model: ModelId | null } | null };
/** Where a new idea came from, for its client key and description footer. */
export type IdeaOrigin = { itemId: string; url: string; recorded: string };

/** Everything the ideas job may do; there is deliberately no complete, archive, delete or claude-label call. */
export type IdeasJobStore = {
  claimReview(): Promise<string | null>;
  getIdea(id: string): Promise<Item | null>;
  openIdeaTitles(): Promise<{ id: string; title: string }[]>;
  settings(id: string): Promise<IdeaSettings | null>;
  /** Writes the next review version and marks the idea done; returns the version. */
  saveReview(id: string, review: IdeaReview, model: ModelId, costUsd: number, note: string | null): Promise<number>;
  /** Counts one real failure: back to waiting, or failed on the second. */
  failReview(id: string, code: string): Promise<ReviewStatus>;
  /** Gives a claim back with no attempt counted: waiting after a passing error, paused at the cap, none for a closed idea. */
  releaseClaim(id: string, status: "waiting" | "paused" | "none"): Promise<void>;
  pauseWaiting(): Promise<number>;
  resumePaused(): Promise<number>;
  recordUsage(row: { model: ModelId; itemId: string; purpose: string; usage: ClaudeUsage }): Promise<number>;
  failureCounts(since: Date): Promise<{ reviews: number; detections: number }>;
  getFlag(key: string): Promise<unknown | null>;
  setFlag(key: string, value: unknown): Promise<void>;
  /** The quote detection stored for this idea, or null for a typed or saved idea. */
  ideaQuote(id: string): Promise<string | null>;
  /** Takes the oldest pending source of these kinds and counts an attempt; two runs never take the same one. */
  claimSource(kinds: SourceKind[]): Promise<ClaimedSource | null>;
  listComments(id: string): Promise<Comment[]>;
  /** Saves the detected ideas and each one's outcome so far on our claimed source; throws ClaimLost if another run took it. */
  saveIdeas(id: string, ideas: SavedIdea[], model: ModelId | null): Promise<void>;
  /** Marks our claimed source done with its ideas and their outcomes; throws ClaimLost if another run took it. */
  finishSource(id: string, ideas: SavedIdea[], model: ModelId | null): Promise<void>;
  /** Records a real failure on the attempt the claim counted: failed on the third, otherwise pending for a later run. */
  failSource(id: string, code: string): Promise<"pending" | "failed">;
  /** Gives back the claim's attempt after a passing error or the cap, which say nothing about the source. */
  releaseSource(id: string): Promise<void>;
  /** Files an inbox capture under ideas as it is, and queues its review. */
  moveCaptureToIdeas(id: string): Promise<void>;
  /** Makes (once per source and index) a new idea item holding the quote, and queues its review; returns its id. */
  addIdeaFrom(origin: IdeaOrigin, n: number, title: string, quote: string): Promise<string>;
  /** Notes on an open idea that Mason said it again; never edits the idea's text. */
  mentionAgain(ideaId: string, sourceUrl: string, date: string, quote: string): Promise<void>;
};

type SettingsRow = {
  item_id: string;
  enrolled: boolean;
  no_web_search: boolean;
  review_status: ReviewStatus;
  review_requested_at: string | null;
  review_note: string | null;
  review_attempts: number;
  last_error: string | null;
};

function toSettings(row: SettingsRow): IdeaSettings {
  return {
    itemId: row.item_id,
    enrolled: row.enrolled,
    noWebSearch: row.no_web_search,
    reviewStatus: row.review_status,
    reviewRequestedAt: row.review_requested_at,
    reviewNote: row.review_note,
    reviewAttempts: row.review_attempts,
    lastError: row.last_error,
  };
}

/** The ideas job's store over the service client, writing as worker:ideas-lab. */
export function createIdeasJobStore(client: SupabaseClient, sourceLeaseMs = SOURCE_LEASE_MS): IdeasJobStore {
  const hub = createHubStore(client, IDEAS_ACTOR);
  // The claim time this run holds per idea; a stale re-claim by another run changes it, which is how a save notices.
  const claims = new Map<string, string>();

  /** Refreshes or finishes our claim in one guarded update; throws ClaimLost when the row is no longer ours. */
  async function updateOwnClaim(id: string, columns: Record<string, unknown>): Promise<void> {
    let query = client.from("idea_settings").update(columns).eq("item_id", id).eq("review_status", "working");
    const held = claims.get(id);
    if (held) query = query.eq("review_claimed_at", held);
    const { data, error } = await query.select("item_id");
    if (error) throw error;
    if ((data ?? []).length === 0) throw new ClaimLost(id);
  }

  // The updated_at this run's last write set per source, and the attempts its claim counted; each write must still match it.
  const sourceClaims = new Map<string, { stamp: string; attempts: number }>();

  /** One guarded write to our claimed source; a write that leaves it pending keeps the claim with the new stamp. */
  async function updateOwnSource(id: string, columns: Record<string, unknown>): Promise<void> {
    const held = sourceClaims.get(id);
    if (!held) throw new ClaimLost(id);
    const { data, error } = await client
      .from("idea_sources")
      .update(columns)
      .eq("source_item_id", id)
      .eq("status", "pending")
      .eq("updated_at", held.stamp)
      .select("updated_at, status");
    if (error) throw error;
    const row = (data as { updated_at: string; status: string }[] | null)?.[0];
    if (!row) throw new ClaimLost(id);
    if (row.status === "pending") sourceClaims.set(id, { ...held, stamp: row.updated_at, attempts: (columns.attempts as number) ?? held.attempts });
    else sourceClaims.delete(id);
  }

  const ideasColumns = (ideas: SavedIdea[], model: ModelId | null) => ({
    quotes: ideas,
    idea_item_ids: ideas.flatMap((i) => (i.outcome ? [i.outcome.id] : [])),
    model,
  });

  /** Enrolls an idea and puts it in the review line; an existing settings row is left as it is. */
  async function queueReview(id: string, scheduleFrom: string): Promise<void> {
    const { error } = await client.from("idea_settings").upsert(
      { item_id: id, enrolled: true, schedule_from: scheduleFrom, review_status: "waiting", review_requested_at: new Date().toISOString() },
      { onConflict: "item_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async function audit(action: string, itemId: string, detail: Record<string, unknown>) {
    const { error } = await client.from("audit_log").insert({ actor: auditActor(IDEAS_ACTOR), action, item_id: itemId, detail });
    if (error) throw error;
  }

  async function moveStatus(from: ReviewStatus, to: ReviewStatus): Promise<number> {
    const { data, error } = await client
      .from("idea_settings")
      .update({ review_status: to })
      .eq("review_status", from)
      .select("item_id");
    if (error) throw error;
    return (data ?? []).length;
  }

  async function readSettings(id: string): Promise<IdeaSettings | null> {
    const { data, error } = await client.from("idea_settings").select("*").eq("item_id", id).maybeSingle();
    if (error) throw error;
    return data ? toSettings(data as SettingsRow) : null;
  }

  async function failedSince(table: "idea_settings" | "idea_sources", column: string, since: Date): Promise<number> {
    const { count, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, "failed")
      .gte("updated_at", since.toISOString());
    if (error) throw error;
    return count ?? 0;
  }

  return {
    async claimReview() {
      const { data, error } = await client.rpc("ideas_claim_review");
      if (error) throw error;
      const id = (data as string | null) ?? null;
      if (!id) return null;
      const { data: row, error: readError } = await client.from("idea_settings").select("review_claimed_at").eq("item_id", id).single();
      if (readError) throw readError;
      claims.set(id, (row as { review_claimed_at: string }).review_claimed_at);
      return id;
    },

    getIdea: (id) => hub.getItem(id),

    async openIdeaTitles() {
      const items = await hub.listItems({ list: "ideas", state: "open", limit: OPEN_IDEAS_LIMIT });
      return items.map((i) => ({ id: i.id, title: i.title }));
    },

    settings: readSettings,

    async saveReview(id, review, model, costUsd, note) {
      // Refreshing the claim first keeps the stale sweep off it while the review row goes in.
      const refreshed = new Date().toISOString();
      await updateOwnClaim(id, { review_claimed_at: refreshed });
      claims.set(id, refreshed);
      const { data: last, error: readError } = await client
        .from("idea_reviews")
        .select("version")
        .eq("item_id", id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (readError) throw readError;
      const version = ((last as { version: number } | null)?.version ?? 0) + 1;
      const { error: insertError } = await client.from("idea_reviews").insert({
        item_id: id,
        version,
        review,
        model,
        prompt_version: PROMPT_VERSION,
        note,
        cost_usd: Math.round(costUsd * 1e6) / 1e6,
      });
      if (insertError) throw insertError;
      await updateOwnClaim(id, { review_status: "done", review_attempts: 0, review_claimed_at: null, last_error: null, review_note: null });
      claims.delete(id);
      await audit("idea-review", id, { version, model });
      return version;
    },

    async failReview(id, code) {
      const current = await readSettings(id);
      const attempts = (current?.reviewAttempts ?? 0) + 1;
      const status: ReviewStatus = attempts >= MAX_FAILED_ATTEMPTS ? "failed" : "waiting";
      const { data, error } = await client
        .from("idea_settings")
        .update({ review_status: status, review_attempts: attempts, review_claimed_at: null, last_error: code })
        .eq("item_id", id)
        .eq("review_status", "working")
        .select("item_id");
      if (error) throw error;
      if ((data ?? []).length === 0) return current?.reviewStatus ?? "none";
      await audit("idea-review-failed", id, { code, attempts });
      return status;
    },

    async releaseClaim(id, status) {
      const { error } = await client
        .from("idea_settings")
        .update({ review_status: status, review_claimed_at: null })
        .eq("item_id", id)
        .eq("review_status", "working");
      if (error) throw error;
    },

    pauseWaiting: () => moveStatus("waiting", "paused"),
    resumePaused: () => moveStatus("paused", "waiting"),

    recordUsage: (row) => recordUsage(client, { feature: "ideas", ...row }),

    async failureCounts(since) {
      const [reviews, detections] = await Promise.all([
        failedSince("idea_settings", "review_status", since),
        failedSince("idea_sources", "status", since),
      ]);
      return { reviews, detections };
    },

    getFlag: (key) => hub.getHubState(key),
    setFlag: (key, value) => hub.setHubState(key, value),

    async ideaQuote(id) {
      const { data, error } = await client
        .from("idea_sources")
        .select("quotes")
        .contains("idea_item_ids", [id])
        .order("created_at")
        .limit(SOURCE_CANDIDATES);
      if (error) throw error;
      const entries = ((data ?? []) as { quotes: unknown }[]).flatMap((row) => savedIdeas(row.quotes) ?? []).filter((i) => i.outcome?.id === id);
      // The source an idea was filed from holds its own words; a later mention is only a repeat.
      return (entries.find((i) => i.outcome?.kind !== "mention") ?? entries[0])?.quote ?? null;
    },

    async claimSource(kinds) {
      const { data, error } = await client
        .from("idea_sources")
        .select("source_item_id, kind, attempts, quotes, model, created_at, updated_at")
        .eq("status", "pending")
        .in("kind", kinds)
        .order("created_at")
        .limit(SOURCE_CANDIDATES);
      if (error) throw error;
      const leaseEnd = Date.now() - sourceLeaseMs;
      type Row = { source_item_id: string; kind: SourceKind; attempts: number; quotes: unknown; model: ModelId | null; created_at: string; updated_at: string };
      for (const row of (data ?? []) as Row[]) {
        const untouched = row.updated_at === row.created_at;
        if (!untouched && Date.parse(row.updated_at) > leaseEnd) continue;
        // A run died holding its third attempt, so the source fails instead of looping on paid calls.
        const exhausted = row.attempts >= MAX_DETECT_ATTEMPTS;
        // The touch trigger moves updated_at, so only the first of two racing runs matches the old value.
        const { data: won, error: claimError } = await client
          .from("idea_sources")
          .update(exhausted ? { status: "failed", last_error: "stale" } : { attempts: row.attempts + 1 })
          .eq("source_item_id", row.source_item_id)
          .eq("status", "pending")
          .eq("updated_at", row.updated_at)
          .select("updated_at");
        if (claimError) throw claimError;
        const stamp = (won as { updated_at: string }[] | null)?.[0]?.updated_at;
        if (!stamp || exhausted) continue;
        sourceClaims.set(row.source_item_id, { stamp, attempts: row.attempts + 1 });
        const ideas = savedIdeas(row.quotes);
        return { itemId: row.source_item_id, kind: row.kind, saved: ideas?.length ? { ideas, model: row.model } : null };
      }
      return null;
    },

    listComments: (id) => hub.listComments(id),

    saveIdeas: (id, ideas, model) => updateOwnSource(id, ideasColumns(ideas, model)),

    async finishSource(id, ideas, model) {
      await updateOwnSource(id, { status: "done", last_error: null, ...ideasColumns(ideas, model) });
      await audit("idea-detect", id, { ideas: ideas.length, model });
    },

    async failSource(id, code) {
      const attempts = sourceClaims.get(id)?.attempts ?? MAX_DETECT_ATTEMPTS;
      const status = attempts >= MAX_DETECT_ATTEMPTS ? "failed" : "pending";
      await updateOwnSource(id, { status, last_error: code });
      await audit("idea-detect-failed", id, { code, attempts });
      return status;
    },

    async releaseSource(id) {
      const held = sourceClaims.get(id);
      if (!held) return;
      await updateOwnSource(id, { attempts: held.attempts - 1 });
    },

    async moveCaptureToIdeas(id) {
      const item = await hub.getItem(id);
      if (!item) throw new Error(`no item ${id}`);
      await hub.updateItem(id, {
        list: "ideas",
        labels: item.labels.includes("idea") ? item.labels : [...item.labels, "idea"],
      });
      await queueReview(id, item.createdAt.slice(0, 10));
      // The insert above skips a row that already exists, so the flag is set on its own.
      const { error } = await client.from("idea_settings").update({ moved_from_inbox: true }).eq("item_id", id);
      if (error) throw error;
    },

    async addIdeaFrom(origin, n, title, quote) {
      const item = await hub.addItem({
        title,
        description: `${quoted(quote)}\n\nSource: ${origin.url}, recorded ${origin.recorded}`,
        list: "ideas",
        labels: ["idea"],
        source: "ideas-lab",
        clientKey: `idea:${origin.itemId}#${n}`,
      });
      await queueReview(item.id, new Date().toISOString().slice(0, 10));
      return item.id;
    },

    async mentionAgain(ideaId, sourceUrl, date, quote) {
      const body = `Mentioned again in ${sourceUrl} on ${date}\n\n${quoted(quote)}`;
      // A retry after a run died between this comment and saving its outcome must not post or count it twice.
      if ((await hub.listComments(ideaId)).some((c) => c.body === body)) return;
      await hub.addComment(ideaId, body);
      // PostgREST has no increment, so compare-and-set, retried when another write got there first.
      for (let tries = 0; tries < 5; tries += 1) {
        const { data, error } = await client.from("idea_settings").select("mention_count").eq("item_id", ideaId).maybeSingle();
        if (error) throw error;
        if (!data) {
          const { error: insertError } = await client.from("idea_settings").insert({ item_id: ideaId, mention_count: 2 });
          if (!insertError) return;
          if (insertError.code !== "23505") throw insertError;
          continue;
        }
        const count = (data as { mention_count: number }).mention_count;
        const { data: updated, error: updateError } = await client
          .from("idea_settings")
          .update({ mention_count: count + 1 })
          .eq("item_id", ideaId)
          .eq("mention_count", count)
          .select("item_id");
        if (updateError) throw updateError;
        if ((updated ?? []).length > 0) return;
      }
      throw new Error(`mention count for ${ideaId} kept changing`);
    },
  };
}

/** Queues a new memo item for detection; the relay calls it only while IDEAS_MEMO_DETECTION is on. */
export async function queueMemoIdeas(client: SupabaseClient, itemId: string): Promise<void> {
  const { error } = await client
    .from("idea_sources")
    .upsert({ source_item_id: itemId, kind: "memo", status: "pending" }, { onConflict: "source_item_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** For the memo split: any memo with a source row, failed included, has its ideas owned by the Ideas Lab; plus which it filed. */
export async function ideasFiledFrom(client: SupabaseClient, memoIds: string[]): Promise<Map<string, MemoIdeas>> {
  const filed = new Map<string, MemoIdeas>();
  // Ids travel in the URL, so ask in batches that stay well under URL length limits.
  for (let start = 0; start < memoIds.length; start += 100) {
    const batch = memoIds.slice(start, start + 100);
    const { data, error } = await client.from("idea_sources").select("source_item_id, idea_item_ids").in("source_item_id", batch);
    if (error) throw error;
    for (const row of (data ?? []) as { source_item_id: string; idea_item_ids: string[] }[]) {
      // A failed memo waits for Try again; if the worker filed its ideas meanwhile, the retry would file them twice.
      filed.set(row.source_item_id, { owned: true, filed: row.idea_item_ids });
    }
  }
  return filed;
}

/** The saved detection on a source row, or null when there is none in the current shape. */
function savedIdeas(quotes: unknown): SavedIdea[] | null {
  const parsed = z.array(SAVED_IDEA).safeParse(quotes);
  return parsed.success ? parsed.data : null;
}

const quoted = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
