import { generateKeyPairSync } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { awardTakeaway, gradeAndGrant, type AwardDeps } from "@/lib/learn/award";
import { GradeError, NO_ANSWER_CARD } from "@/lib/learn/grade";
import { signingKey } from "@/lib/learn/grant";
import type { ReportCard } from "@/lib/learn/types";
import { FakeLearnStore } from "./fake-store";

const TODAY = "2026-11-13";
const NOW = new Date("2026-11-13T18:00:00Z");

function key() {
  const pkcs8 = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" });
  return signingKey(pkcs8.subarray(pkcs8.length - 32).toString("base64"))!;
}

const cardA: ReportCard = {
  grade: "A",
  worked: "You led with what she lost.",
  fix: "Check she followed.",
  better: "Better.",
  resources: [{ title: "The curse of knowledge", url: "https://hbr.org/2006/12/the-curse-of-knowledge" }],
  jargonOpening: false,
  delivery: null,
};

function setup(overrides: Partial<AwardDeps> = {}, exerciseDate = TODAY) {
  const store = new FakeLearnStore();
  store.addExercise({ id: "ex1", date: exerciseDate });
  store.addAnswer({ id: "ans1", exerciseId: "ex1" });
  const grade = vi.fn(async () => ({ card: cardA, usage: { input_tokens: 10, output_tokens: 10 }, model: "claude-opus-5-5" as const }));
  const judge = vi.fn(async () => ({ accepted: true, feedback: "Specific.", usage: { input_tokens: 5, output_tokens: 5 }, model: "claude-haiku-5-5" as const }));
  const deps: AwardDeps = {
    store,
    anthropic: {} as Anthropic,
    key: key(),
    now: () => NOW,
    timeZone: "UTC",
    cap: 10,
    grade,
    judge,
    ...overrides,
  };
  return { store, grade, judge, deps };
}

describe("gradeAndGrant", () => {
  it("grants the grade's minutes, signed for the exercise's day, in one save", async () => {
    const { store, deps } = setup();
    const out = await gradeAndGrant(deps, "ans1");
    expect(out).toMatchObject({ status: "graded", minutes: 4, late: false });
    expect(store.saveGradeCalls).toHaveLength(1);
    const grant = store.saveGradeCalls[0].grant!;
    expect(grant.minutes).toBe(4);
    expect(grant.msg).toBe(`fl-grant-v1|${TODAY}|com.instagram.android|4|${grant.nonce}`);
    expect(store.usage).toHaveLength(1);
  });

  it("clamps to the room left under the daily cap", async () => {
    const eight = setup();
    eight.store.extraGranted = 8;
    expect(await gradeAndGrant(eight.deps, "ans1")).toMatchObject({ status: "graded", minutes: 2 });
    const ten = setup();
    ten.store.extraGranted = 10;
    expect(await gradeAndGrant(ten.deps, "ans1")).toMatchObject({ status: "graded", minutes: 0 });
    expect(ten.store.saveGradeCalls[0].grant).toBeNull();
  });

  it("saves the card with no minutes when the signing key is missing", async () => {
    const { store, deps } = setup({ key: null });
    expect(await gradeAndGrant(deps, "ans1")).toMatchObject({ status: "graded", minutes: 0 });
    expect(store.grades.get("ans1")?.minutes).toBe(0);
    expect(store.grants).toHaveLength(0);
  });

  it("grades a late answer for feedback only", async () => {
    const { store, deps } = setup({}, "2026-11-12");
    expect(await gradeAndGrant(deps, "ans1")).toMatchObject({ status: "graded", minutes: 0, late: true });
    expect(store.grades.get("ans1")?.late).toBe(true);
    expect(store.grants).toHaveLength(0);
  });

  it("grades a silent recording F without calling Claude", async () => {
    const { store, grade, deps } = setup();
    store.answers.set("ans1", { ...store.answers.get("ans1")!, kind: "voice", body: null, clipPath: "answers/x.webm", clipMime: "audio/webm", clipDurationMs: 4000, transcript: "  ", status: "transcribed" });
    const out = await gradeAndGrant(deps, "ans1");
    expect(grade).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "graded", minutes: 0, card: NO_ANSWER_CARD });
  });

  it("waits for a voice transcript", async () => {
    const { store, grade, deps } = setup();
    store.answers.set("ans1", { ...store.answers.get("ans1")!, kind: "voice", body: null, clipPath: "answers/x.webm", clipMime: "audio/webm", clipDurationMs: 4000, transcript: null, status: "awaiting_transcript" });
    expect(await gradeAndGrant(deps, "ans1")).toEqual({ status: "waiting", reason: "transcript" });
    expect(grade).not.toHaveBeenCalled();
  });

  it("stops at the monthly cap without calling Claude", async () => {
    const { store, grade, deps } = setup();
    store.spent = 10;
    expect(await gradeAndGrant(deps, "ans1")).toEqual({ status: "waiting", reason: "cap" });
    expect(grade).not.toHaveBeenCalled();
    expect(store.failed).toEqual([{ id: "ans1", error: "cap" }]);
  });

  it("marks the answer failed when Claude fails, and saves nothing", async () => {
    const { store, deps } = setup({ grade: vi.fn(async () => Promise.reject(new GradeError("api", "overloaded"))) });
    expect(await gradeAndGrant(deps, "ans1")).toEqual({ status: "waiting", reason: "claude" });
    expect(store.failed).toEqual([{ id: "ans1", error: "api" }]);
    expect(store.saveGradeCalls).toHaveLength(0);
  });

  it("logs the cost of a paid grading call that failed, then marks the answer failed", async () => {
    const charge = { model: "claude-opus-5-5" as const, usage: { input_tokens: 7, output_tokens: 3 } };
    const { store, deps } = setup({ grade: vi.fn(async () => Promise.reject(new GradeError("schema", "bad shape", { charge }))) });
    expect(await gradeAndGrant(deps, "ans1")).toEqual({ status: "waiting", reason: "claude" });
    expect(store.usage).toEqual([expect.objectContaining({ model: "claude-opus-5-5", purpose: "grade" })]);
    expect(store.failed).toEqual([{ id: "ans1", error: "schema" }]);
  });

  it("takes minutes only from the grade table, never from Claude's reply", async () => {
    const sneaky = { ...cardA, grade: "C" as const, minutes: 60 } as ReportCard;
    const { deps } = setup({ grade: vi.fn(async () => ({ card: sneaky, usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-opus-5-5" as const })) });
    expect(await gradeAndGrant(deps, "ans1")).toMatchObject({ status: "graded", minutes: 1 });
  });

  it("answers duplicate for an already graded answer without calling Claude", async () => {
    const { store, grade, deps } = setup();
    store.answers.get("ans1")!.status = "graded";
    expect(await gradeAndGrant(deps, "ans1")).toEqual({ status: "duplicate" });
    expect(grade).not.toHaveBeenCalled();
  });

  it("retries once with a new clamp when the database refuses the cap", async () => {
    const { store, deps } = setup();
    store.capOnNextSave = () => {
      store.extraGranted = 9;
    };
    expect(await gradeAndGrant(deps, "ans1")).toMatchObject({ status: "graded", minutes: 1 });
    expect(store.saveGradeCalls.map((c) => c.grant?.minutes ?? 0)).toEqual([4, 1]);
  });
});

describe("awardTakeaway", () => {
  it("grants 1 minute for an accepted takeaway, tied to the exercise", async () => {
    const { store, deps } = setup();
    const judge = deps.judge as ReturnType<typeof vi.fn>;
    expect(await awardTakeaway(deps, "ex1", "Tappers think half know the song; 2.5% do.")).toMatchObject({ status: "judged", accepted: true, minutes: 1 });
    expect(store.grants).toEqual([expect.objectContaining({ minutes: 1, exerciseId: "ex1" })]);
    expect(judge.mock.calls[0][1]).toMatchObject({ excerpt: expect.stringContaining("Only 2.5% did.") });
  });

  it("grants nothing for a rejected takeaway", async () => {
    const { store, deps } = setup({ judge: vi.fn(async () => ({ accepted: false, feedback: "Too general.", usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-haiku-5-5" as const })) });
    expect(await awardTakeaway(deps, "ex1", "It was good.")).toMatchObject({ status: "judged", accepted: false, minutes: 0 });
    expect(store.grants).toHaveLength(0);
  });

  it("answers duplicate for a second takeaway without calling Claude", async () => {
    const { judge, deps } = setup();
    await awardTakeaway(deps, "ex1", "First.");
    expect(await awardTakeaway(deps, "ex1", "Second.")).toEqual({ status: "duplicate" });
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("logs the cost of a failed takeaway check and stops after three tries a day", async () => {
    const charge = { model: "claude-haiku-5-5" as const, usage: { input_tokens: 2, output_tokens: 1 } };
    const judge = vi.fn(async () => Promise.reject(new GradeError("schema", "bad shape", { charge })));
    const { store, deps } = setup({ judge });
    for (let i = 0; i < 3; i++) expect(await awardTakeaway(deps, "ex1", "Try.")).toEqual({ status: "waiting", reason: "claude" });
    expect(store.usage).toHaveLength(3);
    expect(await awardTakeaway(deps, "ex1", "Try again.")).toEqual({ status: "waiting", reason: "limit" });
    expect(judge).toHaveBeenCalledTimes(3);
  });

  it("grants nothing on a late takeaway", async () => {
    const { store, deps } = setup({}, "2026-11-12");
    expect(await awardTakeaway(deps, "ex1", "Specific thing.")).toMatchObject({ status: "judged", minutes: 0 });
    expect(store.grants).toHaveLength(0);
  });
});
