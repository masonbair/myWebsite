import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createHubStore } from "@/lib/hub/store";
import { ClaimLost, createIdeasJobStore, ideasFiledFrom, queueMemoIdeas } from "@/lib/ideas/store";
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

describe.skipIf(!enabled)("ideas detection store against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const hub = () => createHubStore(client(), { kind: "worker", runId: "integration" });

  /** An inbox capture; the intake trigger gives it a pending detection row. */
  const newCapture = (title = "integration capture") =>
    hub().addItem({ title, description: "kept as typed", source: "capture", clientKey: randomUUID() });

  async function source(id: string) {
    const { data, error } = await client().from("idea_sources").select("*").eq("source_item_id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function settingsRow(id: string) {
    const { data, error } = await client().from("idea_settings").select("*").eq("item_id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Claims and closes every pending source left by other tests, leased or not, so the next claim sees only ours. */
  async function drain() {
    const store = createIdeasJobStore(client(), 0);
    for (let claimed = await store.claimSource(["capture", "memo"]); claimed; claimed = await store.claimSource(["capture", "memo"])) {
      await store.finishSource(claimed.itemId, [], [], null);
    }
  }

  it("never hands one source to two parallel claims, and a finish needs the claim", async () => {
    await drain();
    const capture = await newCapture();
    expect(await source(capture.id)).toMatchObject({ kind: "capture", status: "pending", attempts: 0 });
    const [a, b] = await Promise.all([
      createIdeasJobStore(client()).claimSource(["capture"]),
      createIdeasJobStore(client()).claimSource(["capture"]),
    ]);
    expect([a, b].filter((c) => c?.itemId === capture.id)).toHaveLength(1);
    expect(await createIdeasJobStore(client()).claimSource(["capture"])).toBeNull();
    await expect(createIdeasJobStore(client()).finishSource(capture.id, [], [], null)).rejects.toBeInstanceOf(ClaimLost);
  });

  it("counts failures and marks the third failed", async () => {
    await drain();
    const store = createIdeasJobStore(client());
    const capture = await newCapture();
    expect(await store.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture" });
    expect(await store.failSource(capture.id, "schema")).toBe("pending");
    // A failed source waits out the lease before a later run retries it.
    expect(await store.claimSource(["capture"])).toBeNull();
    const noLease = createIdeasJobStore(client(), 0);
    expect(await noLease.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture" });
    expect(await noLease.failSource(capture.id, "schema")).toBe("pending");
    expect(await noLease.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture" });
    expect(await noLease.failSource(capture.id, "refusal")).toBe("failed");
    expect(await source(capture.id)).toMatchObject({ status: "failed", attempts: 3, last_error: "refusal" });
    expect(await noLease.claimSource(["capture"])).toBeNull();
    expect((await store.failureCounts(new Date(Date.now() - 60_000))).detections).toBeGreaterThanOrEqual(1);
  });

  it("moves a capture to ideas as typed, enrolled and marked moved from the inbox", async () => {
    const store = createIdeasJobStore(client());
    const capture = await newCapture("integration move");
    await store.moveCaptureToIdeas(capture.id);
    expect(await hub().getItem(capture.id)).toMatchObject({ title: "integration move", description: "kept as typed", list: "ideas", labels: ["idea"] });
    expect(await settingsRow(capture.id)).toMatchObject({
      enrolled: true,
      review_status: "waiting",
      moved_from_inbox: true,
      schedule_from: capture.createdAt.slice(0, 10),
    });
  });

  it("adds a new idea once per client key, with no detection row of its own", async () => {
    const store = createIdeasJobStore(client());
    const capture = await newCapture();
    const origin = { itemId: capture.id, url: capture.url, recorded: capture.createdAt };
    const first = await store.addIdeaFrom(origin, 0, "Sourdough timer", "a timer for sourdough");
    expect(await store.addIdeaFrom(origin, 0, "Sourdough timer", "a timer for sourdough")).toBe(first);
    const idea = await hub().getItem(first);
    expect(idea).toMatchObject({
      title: "Sourdough timer",
      list: "ideas",
      labels: ["idea"],
      source: "ideas-lab",
      description: `> a timer for sourdough\n\nSource: ${capture.url}, recorded ${capture.createdAt}`,
    });
    const { data: keyed } = await client().from("items").select("id").eq("client_key", `idea:${capture.id}#0`);
    expect(keyed).toEqual([{ id: first }]);
    expect(await source(first)).toBeNull();
    expect(await settingsRow(first)).toMatchObject({ enrolled: true, review_status: "waiting", moved_from_inbox: false, mention_count: 1 });
  });

  it("stores quotes for the review and counts a mention with a comment", async () => {
    await drain();
    const store = createIdeasJobStore(client());
    const capture = await newCapture();
    const origin = { itemId: capture.id, url: capture.url, recorded: capture.createdAt };
    const idea = await store.addIdeaFrom(origin, 0, "Bakery map", "a map of bakeries");
    expect(await store.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture" });
    await store.finishSource(capture.id, [idea], ["a map of bakeries"], "claude-haiku-5-5");
    expect(await source(capture.id)).toMatchObject({ status: "done", idea_item_ids: [idea], quotes: ["a map of bakeries"], model: "claude-haiku-5-5" });
    expect(await store.ideaQuote(idea)).toBe("a map of bakeries");

    await store.mentionAgain(idea, "https://masonbair.com/hub/item/x", "2026-11-09", "bakery map again");
    expect((await settingsRow(idea))?.mention_count).toBe(2);
    expect((await hub().listComments(idea)).map((c) => c.body)).toEqual([
      "Mentioned again in https://masonbair.com/hub/item/x on 2026-11-09\n\n> bakery map again",
    ]);
    expect((await hub().getItem(idea))?.description).toBe(`> a map of bakeries\n\nSource: ${capture.url}, recorded ${capture.createdAt}`);
  });

  it("queues a memo once and reports the ideas filed from it", async () => {
    const memo = await hub().addItem({ title: "HiDock memo x", labels: ["hidock-memo"], source: "memo:phone", clientKey: randomUUID() });
    expect(await source(memo.id)).toBeNull();
    await queueMemoIdeas(client(), memo.id);
    await queueMemoIdeas(client(), memo.id);
    expect(await source(memo.id)).toMatchObject({ kind: "memo", status: "pending" });
    expect(await ideasFiledFrom(client(), [memo.id])).toEqual(new Map([[memo.id, []]]));
  });
});
