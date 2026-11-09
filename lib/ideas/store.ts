import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordUsage, type ClaudeUsage, type ModelId } from "@/lib/ai/claude";
import { auditActor } from "@/lib/hub/rules";
import { createHubStore } from "@/lib/hub/store";
import type { Actor, Comment, Item } from "@/lib/hub/types";
import { createSourceStore, type SourceStore } from "./sources";
import { ClaimLost, PROMPT_VERSION, type IdeaReview, type IdeaSettings, type ReviewStatus } from "./types";

export { ClaimLost } from "./types";
export { ideasFiledFrom, queueMemoIdeas, sourceRef, type ClaimedSource } from "./sources";

export const IDEAS_ACTOR: Actor = { kind: "worker", runId: "ideas-lab" };
const MAX_FAILED_ATTEMPTS = 2;
const OPEN_IDEAS_LIMIT = 200;
// idea_sources has no working status, so a claim is a fresh updated_at; longer than a whole run, shorter than the 15-minute cron gap.
const SOURCE_LEASE_MS = 10 * 60 * 1000;

/** Where a new idea came from: `key` goes in its client key `idea:<key>#<n>`, `footer` under its quote, `scheduleFrom` (Mason's local date) starts its returns. */
export type IdeaOrigin = { key: string; footer: string; scheduleFrom: string };

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
  recordUsage(row: { model: ModelId; itemId: string | null; purpose: string; usage: ClaudeUsage }): Promise<number>;
  failureCounts(since: Date): Promise<{ reviews: number; detections: number }>;
  getFlag(key: string): Promise<unknown | null>;
  setFlag(key: string, value: unknown): Promise<void>;
  listComments(id: string): Promise<Comment[]>;
  /** Files an open inbox capture under ideas as it is and queues its review; true when it is (now) an open idea, false when it is anywhere else. */
  moveCaptureToIdeas(id: string, scheduleFrom: string): Promise<boolean>;
  /** Makes (once per source and index) a new idea item holding the quote, and queues its review; returns its id. */
  addIdeaFrom(origin: IdeaOrigin, n: number, title: string, quote: string): Promise<string>;
  /** Notes on an open idea that Mason said it again in `source` (a link or a recording's name); never edits the idea's text. */
  mentionAgain(ideaId: string, source: string, date: string, quote: string): Promise<void>;
} & SourceStore;

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

  /** Enrolls an idea and puts it in the review line; an existing settings row is left as it is. */
  async function queueReview(id: string, scheduleFrom: string): Promise<void> {
    const { error } = await client.from("idea_settings").upsert(
      { item_id: id, enrolled: true, schedule_from: scheduleFrom, review_status: "waiting", review_requested_at: new Date().toISOString() },
      { onConflict: "item_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async function audit(action: string, itemId: string | null, detail: Record<string, unknown>) {
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

  async function failedReviewsSince(since: Date): Promise<number> {
    const { count, error } = await client
      .from("idea_settings")
      .select("*", { count: "exact", head: true })
      .eq("review_status", "failed")
      .gte("updated_at", since.toISOString());
    if (error) throw error;
    return count ?? 0;
  }

  const { failedSince: failedDetectionsSince, ...sources } = createSourceStore(client, audit, sourceLeaseMs);

  return {
    ...sources,

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
        failedReviewsSince(since),
        failedDetectionsSince(since),
      ]);
      return { reviews, detections };
    },

    getFlag: (key) => hub.getHubState(key),
    setFlag: (key, value) => hub.setHubState(key, value),

    listComments: (id) => hub.listComments(id),

    async moveCaptureToIdeas(id, scheduleFrom) {
      // Read fresh: Mason may have filed, finished or archived it since detection read it.
      const item = await hub.getItem(id);
      if (!item || item.state !== "open") return false;
      // Already under ideas (a retry after a run died mid-move, or Mason filed it): nothing to move and nothing to copy.
      if (item.list === "ideas") {
        await queueReview(id, scheduleFrom);
        return true;
      }
      if (item.list !== "inbox") return false;
      await hub.updateItem(id, {
        list: "ideas",
        labels: item.labels.includes("idea") ? item.labels : [...item.labels, "idea"],
      });
      await queueReview(id, scheduleFrom);
      // The insert above skips a row that already exists, so the flag is set on its own.
      const { error } = await client.from("idea_settings").update({ moved_from_inbox: true }).eq("item_id", id);
      if (error) throw error;
      return true;
    },

    async addIdeaFrom(origin, n, title, quote) {
      const item = await hub.addItem({
        title,
        description: `${quoted(quote)}\n\n${origin.footer}`,
        list: "ideas",
        labels: ["idea"],
        source: "ideas-lab",
        clientKey: `idea:${origin.key}#${n}`,
      });
      await queueReview(item.id, origin.scheduleFrom);
      return item.id;
    },

    async mentionAgain(ideaId, source, date, quote) {
      const body = `Mentioned again in ${source} on ${date}\n\n${quoted(quote)}`;
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

const quoted = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
