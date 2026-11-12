"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireOwner } from "@/lib/auth/require-owner";
import { isSameOriginHeaders } from "@/lib/auth/same-origin";
import { awardTakeaway, gradeAndGrant, type AwardResult } from "@/lib/learn/award";
import type { LearnReport } from "@/lib/learn/read";
import { learnRuntime } from "@/lib/learn/runtime";

export type LearnActionResult =
  | { ok: true; status: "graded"; report: LearnReport }
  | { ok: true; status: "pending"; message: string }
  | { ok: false; error: string };
export type TakeawayActionResult = { ok: true; accepted: boolean; feedback: string; minutes: number } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ANSWER = 8000;
const MAX_TAKEAWAY = 500;
const CLIP_EXT: Record<string, string> = { "audio/webm": ".webm", "audio/mp4": ".m4a", "audio/ogg": ".ogg" };
const BAD_REQUEST = { ok: false, error: "Bad request." } as const;
const OTHER_DAY = { ok: false, error: "This card is from another day." } as const;

const WAITING_COPY: Record<Extract<AwardResult, { status: "waiting" }>["reason"], string> = {
  transcript: "Graded soon.",
  cap: "The monthly AI budget is used up. Your answer is saved and will be graded next month.",
  claude: "Grading failed. It retries on its own within 15 minutes.",
  "not-configured": "Grading failed. It retries on its own within 15 minutes.",
};

async function allowed(exerciseId: unknown): Promise<boolean> {
  await requireOwner();
  return isSameOriginHeaders(await headers()) && typeof exerciseId === "string" && UUID.test(exerciseId);
}

function toResult(result: AwardResult): LearnActionResult {
  if (result.status === "graded") return { ok: true, status: "graded", report: { ...result.card, minutes: result.minutes, late: result.late } };
  if (result.status === "waiting") return { ok: true, status: "pending", message: WAITING_COPY[result.reason] };
  return { ok: true, status: "pending", message: "Already graded." };
}

/** Saves a typed answer to today's card and grades it right away; nothing here can set a grade or minutes. */
export async function sendTypedAnswer(exerciseId: string, text: string): Promise<LearnActionResult> {
  if (!(await allowed(exerciseId))) return BAD_REQUEST;
  const body = typeof text === "string" ? text.trim() : "";
  if (body.length < 1 || body.length > MAX_ANSWER) return { ok: false, error: "Write an answer of up to 8,000 characters." };
  const { store, today, awardDeps } = await learnRuntime();
  const exercise = await store.exerciseById(exerciseId);
  if (!exercise || exercise.date !== today) return OTHER_DAY;
  const saved = await store.insertAnswer({ exerciseId, kind: "typed", body });
  if (saved === "duplicate") return { ok: false, error: "Already answered." };
  const result = toResult(await gradeAndGrant(awardDeps, saved.id));
  revalidatePath("/hub/learn");
  return result;
}

/** Saves a recorded clip already uploaded to answers/<exerciseId>.<ext>; grading waits for the phone's transcript. */
export async function sendVoiceAnswer(exerciseId: string, clip: { path: string; mime: string; durationMs: number }): Promise<LearnActionResult> {
  if (!(await allowed(exerciseId))) return BAD_REQUEST;
  const ext = CLIP_EXT[clip?.mime];
  if (!ext || clip.path !== `answers/${exerciseId}${ext}`) return { ok: false, error: "The recording did not upload. Record again." };
  if (!Number.isInteger(clip.durationMs) || clip.durationMs < 1000 || clip.durationMs > 300_000) {
    return { ok: false, error: "Record between 1 second and 5 minutes." };
  }
  const { store, today } = await learnRuntime();
  const exercise = await store.exerciseById(exerciseId);
  if (!exercise || exercise.date !== today) return OTHER_DAY;
  if (!(await store.clipExists(clip.path))) return { ok: false, error: "The recording did not upload. Record again." };
  const saved = await store.insertAnswer({ exerciseId, kind: "voice", clipPath: clip.path, clipMime: clip.mime, clipDurationMs: clip.durationMs });
  if (saved === "duplicate") return { ok: false, error: "Already answered." };
  revalidatePath("/hub/learn");
  return { ok: true, status: "pending", message: WAITING_COPY.transcript };
}

/** Judges a one-line reading takeaway for today's card. */
export async function sendTakeaway(exerciseId: string, takeaway: string): Promise<TakeawayActionResult> {
  if (!(await allowed(exerciseId))) return BAD_REQUEST;
  const text = typeof takeaway === "string" ? takeaway.trim() : "";
  if (text.length < 1 || text.length > MAX_TAKEAWAY) return { ok: false, error: "Write one line, up to 500 characters." };
  const { store, today, awardDeps } = await learnRuntime();
  const exercise = await store.exerciseById(exerciseId);
  if (!exercise || exercise.date !== today) return OTHER_DAY;
  const result = await awardTakeaway(awardDeps, exerciseId, text);
  if (result.status === "duplicate") return { ok: false, error: "You already sent a takeaway for this card." };
  if (result.status === "waiting") return { ok: false, error: WAITING_COPY[result.reason] };
  revalidatePath("/hub/learn");
  return { ok: true, accepted: result.accepted, feedback: result.feedback, minutes: result.minutes };
}
