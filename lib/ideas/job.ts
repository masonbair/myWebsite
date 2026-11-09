import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError } from "@anthropic-ai/sdk";
import { parseMemo } from "@/lib/hub/memo-split";
import type { Message } from "@/lib/hub/notify";
import type { ClaudeUsage, ModelId } from "@/lib/ai/claude";
import { detectIdeas, sameIdea } from "./detect";
import { reviewIdea } from "./review";
import { ClaimLost, type ClaimedSource, type IdeasJobStore } from "./store";
import { CapReached, DetectFailed, ReviewFailed, type SourceKind } from "./types";

export type IdeasJobDeps = {
  store: IdeasJobStore;
  anthropic: Anthropic | null;
  now: () => Date;
  budgetUsd: number;
  webSearchOff: boolean;
  ntfy: (msg: Message) => Promise<void>;
  deadlineMs: number;
  /** This month's ideas spend in USD, read fresh before every review. */
  spend: () => Promise<number>;
  /** Task 8 fills this in; returns how many calendar returns it handled. */
  resurface?: () => Promise<number>;
};

export type IdeasRunResult = { detected: number; reviewed: string[]; failed: string[]; paused: boolean; resurfaced: number };

export const DEFAULT_BUDGET_USD = 20;
// Detection costs cents and must keep running past the review cap so no idea is lost, but not without limit.
const DETECTION_CAP_FACTOR = 1.25;
// Abort a call still running this close to the limit, so the run can record and count it before the function dies.
const ABORT_MARGIN_MS = 15_000;
// A full review with search needs this long before the abort, or a slow idea would be cut off and billed on every run.
const REVIEW_ROOM_MS = 200_000;
// Rate limits, overload, timeouts and conflicts pass on their own; they must not use up an idea's two attempts.
const PASSING_STATUSES = new Set([408, 409, 429]);
// Reviews may only start in the first 55 seconds of a 270-second run, so detection hands over well before that.
const DETECT_BUDGET_MS = 40_000;
// A detection call still running this far into the run is cut off, so it cannot eat the reviews' start window.
const DETECT_ABORT_MS = 50_000;
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

/** The spend read failed: a database problem, not the idea's fault. */
class SpendUnreadable extends Error {
  constructor() {
    super("ideas spend could not be read");
    this.name = "SpendUnreadable";
  }
}

/** Errors that say nothing about the idea; the claim goes back to waiting uncounted. Our own deadline abort counts. */
function isPassing(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return false;
  if (e instanceof SpendUnreadable || e instanceof APIConnectionError) return true;
  const status = statusOf(e);
  return status !== null && (PASSING_STATUSES.has(status) || status >= 500);
}

function failCode(e: unknown, signal: AbortSignal): string {
  if (signal.aborted) return "deadline";
  if (e instanceof ReviewFailed || e instanceof DetectFailed) return e.code;
  if (e instanceof SpendUnreadable) return "spend";
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
    const hooks = paidHooks(deps, id, (spend) => capState(spend, deps.budgetUsd).reviews);
    const { review, model } = await reviewIdea({
      client: anthropic,
      idea: { id, title: idea.title, description: idea.description, quote: await store.ideaQuote(id) },
      others,
      note: settings.reviewNote,
      webSearch: !deps.webSearchOff && !settings.noWebSearch,
      signal,
      beforeCall: hooks.beforeCall,
      record: async (call) => {
        cost += await hooks.record(call);
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
    if (e instanceof ClaimLost) {
      console.error(`ideas review for ${id} lost its claim before saving`);
      return "next";
    }
    const code = failCode(e, signal);
    console.error(`ideas review failed for ${id}: ${code}`);
    if (isPassing(e, signal)) {
      await store.releaseClaim(id, "waiting");
      return "stop";
    }
    await store.failReview(id, code);
    result.failed.push(id);
    return signal.aborted ? "stop" : "next";
  }
}

/** Spend checked before every paid call and usage recorded after it, against one item. */
function paidHooks(deps: IdeasJobDeps, itemId: string, allowed: (spend: number) => boolean) {
  return {
    beforeCall: async () => {
      const spend = await deps.spend().catch(() => {
        throw new SpendUnreadable();
      });
      if (!allowed(spend)) throw new CapReached();
    },
    record: async (call: { purpose: string; model: ModelId; usage: ClaudeUsage }) => {
      try {
        return await deps.store.recordUsage({ model: call.model, itemId, purpose: call.purpose, usage: call.usage });
      } catch (e) {
        console.error(`ideas usage not recorded ${itemId} ${call.model} in=${call.usage.input_tokens} out=${call.usage.output_tokens}`);
        throw e;
      }
    },
  };
}

/** Finds the ideas in one claimed source and files them: a mention, a moved capture, or new idea items. */
async function detectOne(
  deps: IdeasJobDeps,
  anthropic: Anthropic,
  source: ClaimedSource,
  signal: AbortSignal,
): Promise<{ outcome: Outcome; found: number }> {
  const { store } = deps;
  const id = source.itemId;
  try {
    const item = await store.getIdea(id);
    if (!item) throw new Error("missing");
    // Mason filed or closed the capture himself first; a memo is read even once its split archived it.
    const filedByMason = item.state !== "open" || item.list === "ideas" || item.labels.includes("idea");
    if (source.kind === "capture" && !source.saved && filedByMason) {
      await store.finishSource(id, [], null);
      return { outcome: "next", found: 0 };
    }
    const memo = source.kind === "memo" ? parseMemo(item, await store.listComments(id)) : null;
    const origin = { itemId: id, url: item.url, recorded: memo ? memo.recorded : item.createdAt };
    const hooks = paidHooks(deps, id, (spend) => capState(spend, deps.budgetUsd).detection);
    const ctx = {
      client: anthropic,
      signal,
      beforeCall: hooks.beforeCall,
      record: async (call: Parameters<typeof hooks.record>[0]) => {
        await hooks.record(call);
      },
    };
    let saved = source.saved;
    if (!saved) {
      const text = memo ? memo.transcript : [item.title, item.description].filter((t) => t.trim()).join("\n\n");
      const detected = await detectIdeas({ ...ctx, text, kind: source.kind });
      saved = { ideas: detected.ideas.map((i) => ({ ...i, outcome: null })), model: detected.model };
      // Saved before anything is filed, so a retry files the same ideas at the same indexes without asking again.
      if (saved.ideas.length) await store.saveIdeas(id, saved.ideas, saved.model);
    }
    const ideas = saved.ideas;
    const ownIds = new Set(ideas.flatMap((i) => (i.outcome && i.outcome.kind !== "mention" ? [i.outcome.id] : [])));
    const open = ideas.some((i) => !i.outcome) ? (await store.openIdeaTitles()).filter((o) => !ownIds.has(o.id) && o.id !== id) : [];
    const moveWhole = source.kind === "capture" && ideas.length === 1 && ideas[0].whole_item && ideas[0].sure;
    for (const [n, idea] of ideas.entries()) {
      if (idea.outcome) continue;
      const { matchId } = open.length ? await sameIdea({ ...ctx, candidate: `${idea.title}\n${idea.quote}`, open }) : { matchId: null };
      if (matchId) {
        await store.mentionAgain(matchId, item.url, origin.recorded.slice(0, 10), idea.quote);
        idea.outcome = { kind: "mention", id: matchId };
      } else if (moveWhole) {
        await store.moveCaptureToIdeas(id);
        idea.outcome = { kind: "moved", id };
      } else {
        idea.outcome = { kind: "new", id: await store.addIdeaFrom(origin, n, idea.title, idea.quote) };
      }
      if (n < ideas.length - 1) await store.saveIdeas(id, ideas, saved.model);
    }
    await store.finishSource(id, ideas, saved.model);
    return { outcome: "next", found: ideas.length };
  } catch (e) {
    // At the detection cap the source stays pending for next month or a higher cap; nothing is lost.
    if (e instanceof CapReached) {
      await store.releaseSource(id);
      return { outcome: "stop", found: 0 };
    }
    if (e instanceof ClaimLost) {
      console.error(`ideas detection for ${id} lost its claim before saving`);
      return { outcome: "next", found: 0 };
    }
    const code = failCode(e, signal);
    console.error(`ideas detection failed for ${id}: ${code}`);
    if (isPassing(e, signal)) {
      await store.releaseSource(id);
      return { outcome: "stop", found: 0 };
    }
    await store.failSource(id, code);
    return { outcome: signal.aborted ? "stop" : "next", found: 0 };
  }
}

async function detectStep(deps: IdeasJobDeps, startedAt: number): Promise<number> {
  const anthropic = deps.anthropic;
  if (!anthropic) return 0;
  // IDEAS_MEMO_DETECTION only gates queueing in the relay; a memo already queued is always read, or its ideas would be stranded.
  const kinds: SourceKind[] = ["capture", "memo"];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, startedAt + DETECT_ABORT_MS - deps.now().getTime()));
  let found = 0;
  try {
    while (deps.now().getTime() < startedAt + DETECT_BUDGET_MS) {
      const source = await deps.store.claimSource(kinds);
      if (!source) break;
      const done = await detectOne(deps, anthropic, source, controller.signal);
      found += done.found;
      if (done.outcome === "stop") break;
    }
  } finally {
    clearTimeout(timer);
  }
  return found;
}

async function reviewStep(deps: IdeasJobDeps, startedAt: number, result: IdeasRunResult): Promise<void> {
  const anthropic = deps.anthropic;
  if (!anthropic) return;
  const deadline = startedAt + deps.deadlineMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - ABORT_MARGIN_MS - deps.now().getTime()));
  try {
    let resumed = false;
    while (deps.now().getTime() < deadline - ABORT_MARGIN_MS - REVIEW_ROOM_MS) {
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
  result.detected = await detectStep(deps, startedAt);
  await reviewStep(deps, startedAt, result);
  if (deps.resurface) result.resurfaced = await deps.resurface();
  await notifyFailures(deps);
  return result;
}
