import "server-only";
import type { KeyObject } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { learnToday } from "./day";
import { GradeError, gradeAnswer, judgeTakeaway, NO_ANSWER_CARD } from "./grade";
import { signGrant } from "./grant";
import { GRADE_MINUTES, grantMinutes } from "./minutes";
import { LearnCapError, type LearnStore } from "./store";
import { READING_MINUTES, type ReportCard, type SignedGrant } from "./types";

export type AwardDeps = {
  store: LearnStore;
  anthropic: Anthropic | null;
  key: KeyObject | null;
  now: () => Date;
  timeZone: string;
  cap: number;
  grade?: typeof gradeAnswer;
  judge?: typeof judgeTakeaway;
};

export type AwardResult =
  | { status: "graded"; card: ReportCard; minutes: number; late: boolean }
  | { status: "duplicate" }
  | { status: "waiting"; reason: "transcript" | "cap" | "not-configured" | "claude" };

export type TakeawayResult =
  | { status: "judged"; accepted: boolean; feedback: string; minutes: number }
  | { status: "duplicate" }
  | { status: "waiting"; reason: "cap" | "not-configured" | "claude" | "limit" };

// Each failed check is billed, so one reading gets a few tries a day, not unlimited ones.
const MAX_TAKEAWAY_TRIES = 3;

async function grantFor(deps: AwardDeps, date: string, want: number): Promise<SignedGrant | null> {
  const minutes = grantMinutes(want, await deps.store.grantedMinutes(date));
  return minutes > 0 && deps.key ? signGrant(deps.key, date, minutes) : null;
}

const failureCode = (e: unknown) => (e instanceof GradeError ? e.reason : "error");

async function recordFailedCharge(store: LearnStore, e: unknown, purpose: string): Promise<void> {
  if (e instanceof GradeError && e.charge) await store.recordUsage({ model: e.charge.model, itemId: null, purpose, usage: e.charge.usage });
}

/** The only code that grades an answer and makes its grant; minutes come from the grade table, never from Claude. */
export async function gradeAndGrant(deps: AwardDeps, answerId: string): Promise<AwardResult> {
  const loaded = await deps.store.loadAnswer(answerId);
  if (!loaded) throw new Error(`no learn answer ${answerId}`);
  const { answer, exercise } = loaded;
  if (answer.status === "graded") return { status: "duplicate" };

  let card: ReportCard;
  let model: string | null = null;
  if (answer.kind === "voice" && answer.transcript === null) return { status: "waiting", reason: "transcript" };
  if (answer.kind === "voice" && answer.transcript!.trim() === "") {
    card = NO_ANSWER_CARD;
  } else {
    if (!deps.anthropic) return { status: "waiting", reason: "not-configured" };
    if ((await deps.store.spend(deps.now())) >= deps.cap) {
      await deps.store.markFailed(answerId, "cap");
      return { status: "waiting", reason: "cap" };
    }
    try {
      const graded = await (deps.grade ?? gradeAnswer)(deps.anthropic, {
        type: exercise.type,
        topic: exercise.topic,
        question: exercise.question,
        client: exercise.client,
        answerText: answer.kind === "voice" ? answer.transcript! : answer.body!,
        durationMs: answer.clipDurationMs,
      });
      await deps.store.recordUsage({ model: graded.model, itemId: null, purpose: "grade", usage: graded.usage });
      card = graded.card;
      model = graded.model;
    } catch (e) {
      await recordFailedCharge(deps.store, e, "grade");
      await deps.store.markFailed(answerId, failureCode(e));
      return { status: "waiting", reason: "claude" };
    }
  }

  const late = learnToday(deps.now(), deps.timeZone) !== exercise.date;
  const want = late ? 0 : GRADE_MINUTES[card.grade];
  const save = async () => {
    const grant = await grantFor(deps, exercise.date, want);
    const minutes = grant?.minutes ?? 0;
    const saved = await deps.store.saveGrade(answerId, { ...card, minutes, late, model }, grant);
    return { saved, minutes };
  };

  let result: { saved: "ok" | "duplicate"; minutes: number };
  try {
    result = await save();
  } catch (e) {
    if (!(e instanceof LearnCapError)) throw e;
    result = await save();
  }
  if (result.saved === "duplicate") return { status: "duplicate" };
  return { status: "graded", card, minutes: result.minutes, late };
}

/** Judges a reading takeaway and grants the reading minute when it shows he read the article. */
export async function awardTakeaway(deps: AwardDeps, exerciseId: string, takeaway: string): Promise<TakeawayResult> {
  const exercise = await deps.store.exerciseById(exerciseId);
  if (!exercise) throw new Error(`no learn exercise ${exerciseId}`);
  if (await deps.store.readingExists(exerciseId)) return { status: "duplicate" };
  if (!deps.anthropic) return { status: "waiting", reason: "not-configured" };
  if ((await deps.store.spend(deps.now())) >= deps.cap) return { status: "waiting", reason: "cap" };
  if ((await deps.store.takeawayAttempts(exerciseId)) >= MAX_TAKEAWAY_TRIES) return { status: "waiting", reason: "limit" };

  const purpose = `takeaway:${exerciseId}`;
  let verdict: Awaited<ReturnType<typeof judgeTakeaway>>;
  try {
    verdict = await (deps.judge ?? judgeTakeaway)(deps.anthropic, {
      title: exercise.readingTitle,
      url: exercise.readingUrl,
      summary: exercise.readingSummary,
      excerpt: exercise.readingExcerpt,
      takeaway,
    });
  } catch (e) {
    await recordFailedCharge(deps.store, e, purpose);
    return { status: "waiting", reason: "claude" };
  }
  await deps.store.recordUsage({ model: verdict.model, itemId: null, purpose, usage: verdict.usage });

  const late = learnToday(deps.now(), deps.timeZone) !== exercise.date;
  const want = verdict.accepted && !late ? READING_MINUTES : 0;
  const save = async () => {
    const grant = await grantFor(deps, exercise.date, want);
    const minutes = grant?.minutes ?? 0;
    const saved = await deps.store.saveTakeaway(exerciseId, { takeaway, accepted: verdict.accepted, feedback: verdict.feedback, minutes }, grant);
    return { saved, minutes };
  };

  let result: { saved: "ok" | "duplicate"; minutes: number };
  try {
    result = await save();
  } catch (e) {
    if (!(e instanceof LearnCapError)) throw e;
    result = await save();
  }
  if (result.saved === "duplicate") return { status: "duplicate" };
  return { status: "judged", accepted: verdict.accepted, feedback: verdict.feedback, minutes: result.minutes };
}
