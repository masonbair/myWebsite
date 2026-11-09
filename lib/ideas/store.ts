import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordUsage, type ClaudeUsage, type ModelId } from "@/lib/ai/claude";
import { auditActor } from "@/lib/hub/rules";
import { createHubStore } from "@/lib/hub/store";
import type { Actor, Item } from "@/lib/hub/types";
import { PROMPT_VERSION, type IdeaReview, type IdeaSettings, type ReviewStatus } from "./types";

/** The idea is no longer claimed by this run (a stale re-claim or Mason's change); its review must not be saved. */
export class ClaimLost extends Error {
  constructor(id: string) {
    super(`claim lost for ${id}`);
    this.name = "ClaimLost";
  }
}

export const IDEAS_ACTOR: Actor = { kind: "worker", runId: "ideas-lab" };
const MAX_FAILED_ATTEMPTS = 2;
const OPEN_IDEAS_LIMIT = 200;

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
export function createIdeasJobStore(client: SupabaseClient): IdeasJobStore {
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
  };
}
