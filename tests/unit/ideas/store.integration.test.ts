import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createHubStore } from "@/lib/hub/store";
import { ClaimLost, createIdeasJobStore } from "@/lib/ideas/store";
import { validReview } from "./fake-anthropic";

// Run against the Ideas Lab's own stack (scripts/ideas-local-stack.sh) with the same env as tests/unit/hub/store.integration.test.ts.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("ideas job store against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Rows are never deleted, so each new idea gets an earlier request time than every row left by earlier runs.
  let seq = 0;
  const firstInLine = () => new Date(-Date.now() - ++seq).toISOString();

  /** A captured idea that the intake trigger queues, put first in the claim line. */
  async function newIdea(title = "integration idea") {
    const item = await createHubStore(client(), { kind: "worker", runId: "integration" }).addItem({
      title,
      list: "ideas",
      labels: ["idea"],
      source: "capture",
      clientKey: randomUUID(),
    });
    const { error } = await client().from("idea_settings").update({ review_requested_at: firstInLine() }).eq("item_id", item.id);
    if (error) throw error;
    return item;
  }

  it("never hands one idea to two parallel claims", async () => {
    const idea = await newIdea();
    const [a, b] = await Promise.all([createIdeasJobStore(client()).claimReview(), createIdeasJobStore(client()).claimReview()]);
    expect([a, b].filter((id) => id === idea.id)).toHaveLength(1);
    expect(a === null || a !== b).toBe(true);
    expect((await createIdeasJobStore(client()).settings(idea.id))?.reviewStatus).toBe("working");
  });

  it("saves numbered versions, resets attempts and writes an audit row", async () => {
    const store = createIdeasJobStore(client());
    const idea = await newIdea();
    expect(await store.claimReview()).toBe(idea.id);
    expect(await store.failReview(idea.id, "schema")).toBe("waiting");
    expect(await store.claimReview()).toBe(idea.id);
    expect(await store.saveReview(idea.id, validReview(), "claude-opus-5-5", 0.123456789, "a note")).toBe(1);
    expect(await store.settings(idea.id)).toMatchObject({ reviewStatus: "done", reviewAttempts: 0, lastError: null });

    await client().from("idea_settings").update({ review_status: "waiting" }).eq("item_id", idea.id);
    expect(await store.claimReview()).toBe(idea.id);
    expect(await store.saveReview(idea.id, validReview(), "claude-opus-5-5", 0.2, null)).toBe(2);

    const { data: reviews } = await client().from("idea_reviews").select("version, prompt_version, cost_usd, note").eq("item_id", idea.id).order("version");
    expect(reviews).toEqual([
      { version: 1, prompt_version: "review-v1", cost_usd: 0.123457, note: "a note" },
      { version: 2, prompt_version: "review-v1", cost_usd: 0.2, note: null },
    ]);
    const { data: audit } = await client().from("audit_log").select("actor, action").eq("item_id", idea.id);
    expect(audit).toContainEqual({ actor: "worker:ideas-lab", action: "idea-review" });
    expect(audit).toContainEqual({ actor: "worker:ideas-lab", action: "idea-review-failed" });
  });

  it("fails an idea on its second real failure", async () => {
    const store = createIdeasJobStore(client());
    const idea = await newIdea();
    await store.claimReview();
    expect(await store.failReview(idea.id, "refusal")).toBe("waiting");
    await store.claimReview();
    expect(await store.failReview(idea.id, "refusal")).toBe("failed");
    expect(await store.settings(idea.id)).toMatchObject({ reviewStatus: "failed", reviewAttempts: 2, lastError: "refusal" });
    const counts = await store.failureCounts(new Date(Date.now() - 60_000));
    expect(counts.reviews).toBeGreaterThanOrEqual(1);
  });

  it("pauses waiting ideas and resumes them", async () => {
    const store = createIdeasJobStore(client());
    const idea = await newIdea();
    expect(await store.pauseWaiting()).toBeGreaterThanOrEqual(1);
    expect((await store.settings(idea.id))?.reviewStatus).toBe("paused");
    expect(await store.resumePaused()).toBeGreaterThanOrEqual(1);
    expect((await store.settings(idea.id))?.reviewStatus).toBe("waiting");
  });

  it("records usage, lists open idea titles and keeps once-only flags", async () => {
    const store = createIdeasJobStore(client());
    const idea = await newIdea("integration titled idea");
    const cost = await store.recordUsage({ model: "claude-opus-5-5", itemId: idea.id, purpose: "review", usage: { input_tokens: 1_000_000, output_tokens: 0 } });
    expect(cost).toBeCloseTo(4);
    const { data: usage } = await client().from("ai_usage").select("feature, purpose").eq("item_id", idea.id);
    expect(usage).toEqual([{ feature: "ideas", purpose: "review" }]);
    expect(await store.openIdeaTitles()).toContainEqual({ id: idea.id, title: "integration titled idea" });
    const key = `ideas-cap-notified:20${String(Math.floor(Math.random() * 90) + 10)}-01`;
    await store.setFlag(key, "sent");
    expect(await store.getFlag(key)).toBe("sent");
  });

  it("releases a claim uncounted, and a late save or failure cannot overwrite a finished review", async () => {
    const store = createIdeasJobStore(client());
    const idea = await newIdea();
    expect(await store.claimReview()).toBe(idea.id);
    await store.releaseClaim(idea.id, "paused");
    expect(await store.settings(idea.id)).toMatchObject({ reviewStatus: "paused", reviewAttempts: 0 });
    await store.releaseClaim(idea.id, "waiting");
    expect((await store.settings(idea.id))?.reviewStatus).toBe("paused");

    await client().from("idea_settings").update({ review_status: "waiting" }).eq("item_id", idea.id);
    expect(await store.claimReview()).toBe(idea.id);
    await store.saveReview(idea.id, validReview(), "claude-opus-5-5", 0.1, null);
    await store.failReview(idea.id, "schema");
    await store.releaseClaim(idea.id, "none");
    expect(await store.settings(idea.id)).toMatchObject({ reviewStatus: "done", reviewAttempts: 0, lastError: null });
  });

  it("refuses to save a review after another run re-claimed the idea, before writing any review row", async () => {
    const store = createIdeasJobStore(client());
    const idea = await newIdea();
    expect(await store.claimReview()).toBe(idea.id);
    await client().from("idea_settings").update({ review_claimed_at: "2001-01-01T00:00:00Z" }).eq("item_id", idea.id);
    await expect(store.saveReview(idea.id, validReview(), "claude-opus-5-5", 0.1, null)).rejects.toBeInstanceOf(ClaimLost);
    const { data: reviews } = await client().from("idea_reviews").select("version").eq("item_id", idea.id);
    expect(reviews).toEqual([]);
    expect((await store.settings(idea.id))?.reviewStatus).toBe("working");
  });
});
