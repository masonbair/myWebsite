import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIUserAbortError } from "@anthropic-ai/sdk";
import type { Message } from "@/lib/hub/notify";
import { reviewIdea } from "./review";
import type { IdeasJobStore } from "./store";
import { CapReached, ReviewFailed } from "./types";

export type IdeasJobDeps = {
  store: IdeasJobStore;
  anthropic: Anthropic | null;
  now: () => Date;
  budgetUsd: number;
  webSearchOff: boolean;
  memoDetection: boolean;
  ntfy: (msg: Message) => Promise<void>;
  deadlineMs: number;
  /** This month's ideas spend in USD, read fresh before every review. */
  spend: () => Promise<number>;
  /** Task 6 fills this in; returns how many ideas it found. */
  detect?: () => Promise<number>;
  /** Task 8 fills this in; returns how many calendar returns it handled. */
  resurface?: () => Promise<number>;
};

export type IdeasRunResult = { detected: number; reviewed: string[]; failed: string[]; paused: boolean; resurfaced: number };

export const DEFAULT_BUDGET_USD = 20;
// Detection costs cents and must keep running past the review cap so no idea is lost, but not without limit.
const DETECTION_CAP_FACTOR = 1.25;
// A review with search can take a couple of minutes, so none starts this close to the function's time limit.
const START_MARGIN_MS = 150_000;
// Abort a call still running this close to the limit, so the claim is released instead of left for the stale sweep.
const ABORT_MARGIN_MS = 15_000;
// Rate limits, overload, timeouts and conflicts pass on their own; they must not use up an idea's two attempts.
const PASSING_STATUSES = new Set([408, 409, 429]);
const DAY_MS = 24 * 60 * 60 * 1000;
const IDEAS_URL = "https://masonbair.com/hub/ideas";

export function capState(spend: number, budget: number): { reviews: boolean; detection: boolean } {
  return { reviews: spend < budget, detection: spend < budget * DETECTION_CAP_FACTOR };
}

/** IDEAS_MONTHLY_BUDGET_USD as a number, or the default when unset or invalid. */
export function budgetFromEnv(value: string | undefined): number {
  const n = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUDGET_USD;
}

function statusOf(e: unknown): number | null {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** Errors that say nothing about the idea; the claim goes back to waiting uncounted. */
function isPassing(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted || e instanceof APIUserAbortError || e instanceof APIConnectionError) return true;
  const status = statusOf(e);
  return status !== null && (PASSING_STATUSES.has(status) || status >= 500);
}

function failCode(e: unknown, signal: AbortSignal): string {
  if (e instanceof ReviewFailed) return e.code;
  if (signal.aborted || e instanceof APIUserAbortError) return "aborted";
  if (e instanceof APIConnectionError) return "connection";
  const status = statusOf(e);
  return status !== null ? `api_${status}` : "error";
}

/** Sends one ntfy message unless the flag is set; the flag is set only after a successful send. */
async function notifyOnce(deps: IdeasJobDeps, key: string, msg: Message): Promise<void> {
  if (await deps.store.getFlag(key)) return;
  try {
    await deps.ntfy(msg);
  } catch (e) {
    console.error(`ideas ntfy not sent for ${key}: ${(e as Error).message}`);
    return;
  }
  await deps.store.setFlag(key, deps.now().toISOString());
}

async function pauseForCap(deps: IdeasJobDeps, spend: number): Promise<void> {
  await deps.store.pauseWaiting();
  const month = deps.now().toISOString().slice(0, 7);
  await notifyOnce(deps, `ideas-cap-notified:${month}`, {
    title: "Idea reviews paused: monthly cap reached",
    message: `Ideas spent $${spend.toFixed(2)} of $${deps.budgetUsd.toFixed(2)} this month. Reviews wait in order and start again next month or when the cap is raised.`,
    clickUrl: IDEAS_URL,
  });
}

type Outcome = "next" | "stop";

async function reviewOne(
  deps: IdeasJobDeps,
  anthropic: Anthropic,
  id: string,
  result: IdeasRunResult,
  signal: AbortSignal,
): Promise<Outcome> {
  const { store } = deps;
  try {
    const [idea, settings] = await Promise.all([store.getIdea(id), store.settings(id)]);
    if (!idea || !settings) throw new Error("missing");
    if (idea.state !== "open") {
      await store.releaseClaim(id, "none");
      return "next";
    }
    const others = (await store.openIdeaTitles()).filter((o) => o.id !== id);
    let cost = 0;
    const { review, model } = await reviewIdea({
      client: anthropic,
      idea: { id, title: idea.title, description: idea.description, quote: null },
      others,
      note: settings.reviewNote,
      webSearch: !deps.webSearchOff && !settings.noWebSearch,
      signal,
      beforeCall: async () => {
        if (!capState(await deps.spend(), deps.budgetUsd).reviews) throw new CapReached();
      },
      record: async (call) => {
        try {
          cost += await store.recordUsage({ model: call.model, itemId: id, purpose: call.purpose, usage: call.usage });
        } catch (e) {
          console.error(`ideas usage not recorded ${id} ${call.model} in=${call.usage.input_tokens} out=${call.usage.output_tokens}`);
          throw e;
        }
      },
    });
    await store.saveReview(id, review, model, cost, settings.reviewNote);
    result.reviewed.push(id);
    return "next";
  } catch (e) {
    if (e instanceof CapReached) {
      await store.releaseClaim(id, "paused");
      await pauseForCap(deps, await deps.spend());
      result.paused = true;
      return "stop";
    }
    const code = failCode(e, signal);
    console.error(`ideas review failed for ${id}: ${code}`);
    if (isPassing(e, signal)) {
      await store.releaseClaim(id, "waiting");
      return "stop";
    }
    await store.failReview(id, code);
    result.failed.push(id);
    return "next";
  }
}

async function reviewStep(deps: IdeasJobDeps, startedAt: number, result: IdeasRunResult): Promise<void> {
  const anthropic = deps.anthropic;
  if (!anthropic) return;
  const deadline = startedAt + deps.deadlineMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - ABORT_MARGIN_MS - deps.now().getTime()));
  try {
    let resumed = false;
    while (deps.now().getTime() <= deadline - START_MARGIN_MS) {
      const spend = await deps.spend();
      if (!capState(spend, deps.budgetUsd).reviews) {
        await pauseForCap(deps, spend);
        result.paused = true;
        return;
      }
      if (!resumed) {
        await deps.store.resumePaused();
        resumed = true;
      }
      const id = await deps.store.claimReview();
      if (!id) return;
      if ((await reviewOne(deps, anthropic, id, result, controller.signal)) === "stop") return;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function notifyFailures(deps: IdeasJobDeps): Promise<void> {
  const now = deps.now();
  const key = `ideas-failures-notified:${now.toISOString().slice(0, 10)}`;
  if (await deps.store.getFlag(key)) return;
  const { reviews, detections } = await deps.store.failureCounts(new Date(now.getTime() - DAY_MS));
  if (reviews + detections === 0) return;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  await notifyOnce(deps, key, {
    title: "Some ideas need a retry",
    message: `In the last day ${plural(reviews, "review")} and ${plural(detections, "detection")} failed. Open the Ideas Lab to retry.`,
    clickUrl: IDEAS_URL,
  });
}

/** One run of the ideas event: detect, review under the monthly cap, resurface, then the daily failure message. */
export async function runIdeasJob(deps: IdeasJobDeps): Promise<IdeasRunResult> {
  const startedAt = deps.now().getTime();
  const result: IdeasRunResult = { detected: 0, reviewed: [], failed: [], paused: false, resurfaced: 0 };
  if (deps.detect) result.detected = await deps.detect();
  await reviewStep(deps, startedAt, result);
  if (deps.resurface) result.resurfaced = await deps.resurface();
  await notifyFailures(deps);
  return result;
}
