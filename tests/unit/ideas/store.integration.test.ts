import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createHubStore } from "@/lib/hub/store";
import { listFailedSources } from "@/lib/ideas/read";
import { insertRecording } from "@/lib/ideas/recording";
import { ClaimLost, createIdeasJobStore, ideasFiledFrom, queueMemoIdeas, sourceRef } from "@/lib/ideas/store";
import { recordingRef } from "@/lib/ideas/types";
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
    const all = ["capture", "memo", "recording"] as const;
    for (let claimed = await store.claimSource([...all]); claimed; claimed = await store.claimSource([...all])) {
      await store.finishSource(sourceRef(claimed), [], null);
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
    expect([a, b].filter((c) => c && sourceRef(c) === capture.id)).toHaveLength(1);
    expect(await createIdeasJobStore(client()).claimSource(["capture"])).toBeNull();
    await expect(createIdeasJobStore(client()).finishSource(capture.id, [], null)).rejects.toBeInstanceOf(ClaimLost);
  });

  it("counts failures and marks the third failed", async () => {
    await drain();
    const store = createIdeasJobStore(client());
    const capture = await newCapture();
    expect(await store.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture", saved: null });
    expect(await store.failSource(capture.id, "schema")).toBe("pending");
    // A failed source waits out the lease before a later run retries it.
    expect(await store.claimSource(["capture"])).toBeNull();
    const noLease = createIdeasJobStore(client(), 0);
    expect(await noLease.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture", saved: null });
    expect(await noLease.failSource(capture.id, "schema")).toBe("pending");
    expect(await noLease.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture", saved: null });
    expect(await noLease.failSource(capture.id, "refusal")).toBe("failed");
    expect(await source(capture.id)).toMatchObject({ status: "failed", attempts: 3, last_error: "refusal" });
    expect(await noLease.claimSource(["capture"])).toBeNull();
    expect((await store.failureCounts(new Date(Date.now() - 60_000))).detections).toBeGreaterThanOrEqual(1);
  });

  it("moves a capture to ideas as typed, enrolled and marked moved from the inbox", async () => {
    const store = createIdeasJobStore(client());
    const capture = await newCapture("integration move");
    expect(await store.moveCaptureToIdeas(capture.id, "2026-11-08")).toBe(true);
    expect(await hub().getItem(capture.id)).toMatchObject({ title: "integration move", description: "kept as typed", list: "ideas", labels: ["idea"] });
    expect(await settingsRow(capture.id)).toMatchObject({
      enrolled: true,
      review_status: "waiting",
      moved_from_inbox: true,
      schedule_from: "2026-11-08",
    });
  });

  it("never moves a capture Mason filed elsewhere or archived", async () => {
    const store = createIdeasJobStore(client());
    const todo = await newCapture("integration todo");
    await hub().updateItem(todo.id, { list: "todo" });
    expect(await store.moveCaptureToIdeas(todo.id, "2026-11-08")).toBe(false);
    expect(await hub().getItem(todo.id)).toMatchObject({ list: "todo" });
    expect(await settingsRow(todo.id)).toBeNull();
  });

  it("adds a new idea once per client key, with no detection row of its own", async () => {
    const store = createIdeasJobStore(client());
    const capture = await newCapture();
    const origin = { key: capture.id, footer: `Source: ${capture.url}, recorded ${capture.createdAt}`, scheduleFrom: "2026-11-09" };
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
    const origin = { key: capture.id, footer: `Source: ${capture.url}, recorded ${capture.createdAt}`, scheduleFrom: "2026-11-09" };
    const idea = await store.addIdeaFrom(origin, 0, "Bakery map", "a map of bakeries");
    expect(await store.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture", saved: null });
    const saved = [{ title: "Bakery map", quote: "a map of bakeries", whole_item: false, sure: false, outcome: { kind: "new" as const, id: idea } }];
    await store.finishSource(capture.id, saved, "claude-haiku-5-5");
    expect(await source(capture.id)).toMatchObject({ status: "done", idea_item_ids: [idea], quotes: saved, model: "claude-haiku-5-5" });
    expect(await store.ideaQuote(idea)).toBe("a map of bakeries");

    await store.mentionAgain(idea, "https://masonbair.com/hub/item/x", "2026-11-09", "bakery map again");
    // A retry of the same mention posts and counts nothing more.
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
    expect(await ideasFiledFrom(client(), [memo.id])).toEqual(new Map([[memo.id, { owned: true, filed: [] }]]));
  });

  it("reports the Ideas Lab owns a memo's ideas whenever it has a source row, failed included, and not without one", async () => {
    await drain();
    const memo = () => hub().addItem({ title: "HiDock memo y", labels: ["hidock-memo"], source: "memo:phone", clientKey: randomUUID() });
    const [pending, failed, done, none] = await Promise.all([memo(), memo(), memo(), memo()]);
    for (const m of [pending, failed, done]) await queueMemoIdeas(client(), m.id);
    await client().from("idea_sources").update({ status: "failed" }).eq("source_item_id", failed.id);
    await client().from("idea_sources").update({ status: "done", idea_item_ids: [pending.id] }).eq("source_item_id", done.id);
    const owned = await ideasFiledFrom(client(), [pending.id, failed.id, done.id, none.id]);
    expect(owned.get(pending.id)).toEqual({ owned: true, filed: [] });
    expect(owned.get(failed.id)).toEqual({ owned: true, filed: [] });
    expect(owned.get(done.id)).toEqual({ owned: true, filed: [pending.id] });
    expect(owned.get(none.id)).toBeUndefined();
  });

  it("saves detection progress so a later claim gets it back, and gives a passing stop's attempt back", async () => {
    await drain();
    const store = createIdeasJobStore(client(), 0);
    const capture = await newCapture();
    expect((await store.claimSource(["capture"]))?.saved).toBeNull();
    expect(await source(capture.id)).toMatchObject({ attempts: 1 });
    const ideas = [
      { title: "A", quote: "qa", whole_item: false, sure: false, outcome: { kind: "mention" as const, id: capture.id } },
      { title: "B", quote: "qb", whole_item: false, sure: false, outcome: null },
    ];
    await store.saveIdeas(capture.id, ideas, "claude-haiku-5-5");
    await store.releaseSource(capture.id);
    expect(await source(capture.id)).toMatchObject({ status: "pending", attempts: 0, idea_item_ids: [capture.id] });
    expect(await store.claimSource(["capture"])).toEqual({ itemId: capture.id, kind: "capture", saved: { ideas, model: "claude-haiku-5-5" } });
  });

  it("fails a source whose third claim died without a finish, instead of claiming it again", async () => {
    await drain();
    const capture = await newCapture();
    for (let run = 0; run < 3; run += 1) {
      expect(((c) => c && sourceRef(c))(await createIdeasJobStore(client(), 0).claimSource(["capture"]))).toBe(capture.id);
    }
    expect(await createIdeasJobStore(client(), 0).claimSource(["capture"])).toBeNull();
    expect(await source(capture.id)).toMatchObject({ status: "failed", attempts: 3, last_error: "stale" });
  });

  it("gives the review the quote an idea was filed from, not a later mention", async () => {
    const store = createIdeasJobStore(client(), 0);
    // The mention's source is older, so a plain oldest-first pick would get the wrong quote.
    const later = await newCapture();
    const ideaSource = await newCapture();
    const idea = await store.addIdeaFrom({ key: ideaSource.id, footer: `Source: ${ideaSource.url}, recorded ${ideaSource.createdAt}`, scheduleFrom: "2026-11-09" }, 0, "Q", "first words");
    const entry = { title: "Q", whole_item: false, sure: false };
    await client().from("idea_sources").update({ quotes: [{ ...entry, quote: "said again", outcome: { kind: "mention", id: idea } }], idea_item_ids: [idea] }).eq("source_item_id", later.id);
    await client().from("idea_sources").update({ quotes: [{ ...entry, quote: "first words", outcome: { kind: "new", id: idea } }], idea_item_ids: [idea] }).eq("source_item_id", ideaSource.id);
    expect(await store.ideaQuote(idea)).toBe("first words");
  });
});

describe.skipIf(!enabled)("HiNote recordings against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const newFile = () => `rec-${randomUUID()}`;

  async function newRecording(transcript = "an idea: a sourdough timer") {
    const file = newFile();
    expect(await insertRecording(client(), { file, recorded: "2026-11-08T09:00:00-05:00", transcript })).toBe("created");
    return file;
  }

  async function recording(file: string) {
    const { data, error } = await client().from("idea_recordings").select("*").eq("file", file).single();
    if (error) throw error;
    return data;
  }

  /** Closes every pending recording left by other tests, so the next claim sees only ours. */
  async function drain() {
    const store = createIdeasJobStore(client(), 0);
    for (let claimed = await store.claimSource(["recording"]); claimed; claimed = await store.claimSource(["recording"])) {
      await store.finishSource(sourceRef(claimed), [], null);
    }
  }

  it("saves a recording once per file name; a resend is a duplicate that changes nothing", async () => {
    const file = await newRecording("first words");
    expect(await insertRecording(client(), { file, recorded: "2026-01-01T00:00:00Z", transcript: "other words" })).toBe("duplicate");
    const { data } = await client().from("idea_recordings").select("file, recorded, transcript, status").eq("file", file);
    expect(data).toEqual([{ file, recorded: "2026-11-08T14:00:00+00:00", transcript: "first words", status: "pending" }]);
  });

  it("claims a recording once, saves progress, gives a passing stop back and resumes from the saved detection", async () => {
    await drain();
    const file = await newRecording();
    const [a, b] = await Promise.all([
      createIdeasJobStore(client()).claimSource(["recording"]),
      createIdeasJobStore(client()).claimSource(["recording"]),
    ]);
    expect([a, b].filter((c) => c && sourceRef(c) === recordingRef(file))).toHaveLength(1);
    // The winner holds a 10-minute lease; a zero-lease store takes it over, as a run after the lease would.
    const store = createIdeasJobStore(client(), 0);
    const claimed = await store.claimSource(["recording"]);
    expect(claimed).toEqual({ kind: "recording", file, recorded: "2026-11-08T14:00:00+00:00", transcript: "an idea: a sourdough timer", saved: null });
    const ideas = [{ title: "Sourdough timer", quote: "a timer", whole_item: false, sure: false, outcome: null }];
    await store.saveIdeas(recordingRef(file), ideas, "claude-haiku-5-5");
    await store.releaseSource(recordingRef(file));
    expect(await recording(file)).toMatchObject({ status: "pending", attempts: 1, quotes: ideas });
    expect((await store.claimSource(["recording"]))?.saved).toEqual({ ideas, model: "claude-haiku-5-5" });
    await store.finishSource(recordingRef(file), ideas, "claude-haiku-5-5");
    expect(await recording(file)).toMatchObject({ status: "done", attempts: 2 });
    const { data: audit } = await client().from("audit_log").select("item_id, action, detail").eq("detail->>recording", file);
    expect(audit).toEqual([{ item_id: null, action: "idea-detect", detail: { recording: file, ideas: 1, model: "claude-haiku-5-5" } }]);
  });

  it("fails a recording on its third failure, lists it under Could not read, and counts it", async () => {
    await drain();
    const file = await newRecording();
    const store = createIdeasJobStore(client(), 0);
    for (const expected of ["pending", "pending", "failed"]) {
      expect(await store.claimSource(["recording"])).toMatchObject({ kind: "recording", file });
      expect(await store.failSource(recordingRef(file), "schema")).toBe(expected);
    }
    expect(await store.claimSource(["recording"])).toBeNull();
    expect(await listFailedSources(client())).toContainEqual(
      expect.objectContaining({ ref: recordingRef(file), itemId: null, kind: "recording", title: `HiNote recording ${file}` }),
    );
    expect((await store.failureCounts(new Date(Date.now() - 60_000))).detections).toBeGreaterThanOrEqual(1);
  });

  it("fails a recording whose third claim died without a finish, instead of claiming it again", async () => {
    await drain();
    const file = await newRecording();
    for (let run = 0; run < 3; run += 1) {
      expect(await createIdeasJobStore(client(), 0).claimSource(["recording"])).toMatchObject({ file });
    }
    expect(await createIdeasJobStore(client(), 0).claimSource(["recording"])).toBeNull();
    expect(await recording(file)).toMatchObject({ status: "failed", attempts: 3, last_error: "stale" });
  });

  it("knows a memo's recording by its device file name or its stem", async () => {
    const file = await newRecording();
    const store = createIdeasJobStore(client());
    expect(await store.recordingExists(`${file}.hda`)).toBe(true);
    expect(await store.recordingExists(file)).toBe(true);
    expect(await store.recordingExists(`${newFile()}.hda`)).toBe(false);
  });

  it("gives the review the quote a recording filed an idea from", async () => {
    const file = await newRecording();
    const store = createIdeasJobStore(client(), 0);
    const idea = await store.addIdeaFrom({ key: recordingRef(file), footer: `From HiNote recording ${file}, recorded 2026-11-08 07:00 MST`, scheduleFrom: "2026-11-09" }, 0, "Q", "spoken words");
    const { data: keyed } = await client().from("items").select("id, description").eq("client_key", `idea:rec:${file}#0`);
    expect(keyed).toEqual([{ id: idea, description: `> spoken words\n\nFrom HiNote recording ${file}, recorded 2026-11-08 14:00 UTC` }]);
    await client()
      .from("idea_recordings")
      .update({ quotes: [{ title: "Q", quote: "spoken words", whole_item: false, sure: false, outcome: { kind: "new", id: idea } }], idea_item_ids: [idea] })
      .eq("file", file);
    expect(await store.ideaQuote(idea)).toBe("spoken words");
  });
});
