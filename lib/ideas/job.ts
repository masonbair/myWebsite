import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError } from "@anthropic-ai/sdk";
import { formatInstantIn } from "@/lib/hub/format";
import { parseMemo } from "@/lib/hub/memo-split";
import type { Message } from "@/lib/hub/notify";
import type { ClaudeUsage, ModelId } from "@/lib/ai/claude";
import { detectIdeas, sameIdea } from "./detect";
import { localDate } from "./resurface";
import { reviewIdea, StartedThenFailed } from "./review";
import { ClaimLost, sourceRef, type ClaimedSource, type IdeaOrigin, type IdeasJobStore } from "./store";
import { CapReached, DetectFailed, recordingRef, ReviewFailed, type DetectKind, type SourceKind } from "./types";

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
  /** Brings ideas back on the calendar; returns how many returns it sent, closed or skipped. */
  resurface?: () => Promise<number>;
  /** Mason's current time zone, for idea footers, mention dates and schedule starts. */
  timeZone: () => Promise<string>;
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
  if (signal.aborted || e instanceof StartedThenFailed) return false;
  if (e instanceof SpendUnreadable || e instanceof APIConnectionError) return true;
  const status = statusOf(e);
  return status !== null && (PASSING_STATUSES.has(status) || status >= 500);
}

function failCode(e: unknown, signal: AbortSignal): string {
  if (signal.aborted) return "deadline";
  if (e instanceof StartedThenFailed) return failCode(e.original, signal);
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

async function pauseForCap(deps: IdeasJobDeps, spend: number | null): Promise<void> {
  await deps.store.pauseWaiting();
  const month = deps.now().toISOString().slice(0, 7);
  const spent = spend === null ? "Ideas reached" : `Ideas spent $${spend.toFixed(2)} of`;
  await notifyOnce(deps, `ideas-cap-notified:${month}`, {
    title: "Idea reviews paused: monthly cap reached",
    message: `${spent} $${deps.budgetUsd.toFixed(2)} this month. Reviews wait in order and start again next month or when the cap is raised.`,
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
      // A failed spend read here must not end the run before the calendar step and the failure message.
      await pauseForCap(deps, await deps.spend().catch(() => null));
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
function paidHooks(deps: IdeasJobDeps, itemId: string | null, allowed: (spend: number) => boolean) {
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

/** What detection reads from one source, and how ideas filed from it name it. */
type SourceView = {
  text: string;
  prompt: SourceKind;
  origin: IdeaOrigin;
  /** Named in a mention comment: the source item's link, or the recording. */
  mentionedIn: string;
  recorded: string;
  /** The source's own item, or null for a recording, which has none. */
  itemId: string | null;
};

/** Reads a claimed source, or null when it needs no reading: Mason filed the capture himself, or the Mac already sent the memo's recording. */
async function viewOf(store: IdeasJobStore, source: ClaimedSource, local: LocalTime): Promise<SourceView | null> {
  if (source.kind === "recording") {
    const name = `HiNote recording ${source.file}`;
    const recorded = new Date(source.recorded).toISOString();
    return {
      text: source.transcript,
      prompt: "memo",
      origin: { key: recordingRef(source.file), footer: `From ${name}, recorded ${local.stamp(recorded)}`, scheduleFrom: local.today },
      mentionedIn: name,
      recorded,
      itemId: null,
    };
  }
  const id = source.itemId;
  const item = await store.getIdea(id);
  if (!item) throw new Error("missing");
  // Mason filed or closed the capture himself first (any list but the inbox); a memo is read even once its split archived it.
  const filedByMason = item.state !== "open" || item.list !== "inbox" || item.labels.includes("idea");
  if (source.kind === "capture" && !source.saved && filedByMason) return null;
  const memo = source.kind === "memo" ? parseMemo(item, await store.listComments(id)) : null;
  // Dedupe by file name at cutover: the read-only HiNote intake already read this recording's ideas.
  if (memo && !source.saved && (await store.recordingExists(memo.file))) return null;
  const recorded = memo ? memo.recorded : item.createdAt;
  return {
    text: memo ? memo.transcript : [item.title, item.description].filter((t) => t.trim()).join("\n\n"),
    prompt: source.kind,
    origin: { key: id, footer: `Source: ${item.url}, recorded ${local.stamp(recorded)}`, scheduleFrom: local.today },
    mentionedIn: item.url,
    recorded,
    itemId: id,
  };
}

/** Mason's local clock for one run: `today` and `day` as YYYY-MM-DD, `stamp` like "2026-11-09 14:25 MST". */
type LocalTime = { today: string; day: (at: string) => string; stamp: (at: string) => string };

// A memo's recorded time is the recorder's own wall clock with no offset, so it is already local and stays as it is.
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:[\d.]+)?$/;

function localTime(zone: string, now: Date): LocalTime {
  const instant = (at: string) => !WALL_CLOCK.test(at) && !Number.isNaN(Date.parse(at));
  return {
    today: localDate(now, zone),
    day: (at) => (instant(at) ? localDate(new Date(at), zone) : at.slice(0, 10)),
    stamp: (at) => (instant(at) ? (formatInstantIn(at, zone) ?? at) : WALL_CLOCK.test(at) ? at.slice(0, 16).replace("T", " ") : at),
  };
}

/** Finds the ideas in one claimed source and files them: a mention, a moved capture, or new idea items. */
async function detectOne(
  deps: IdeasJobDeps,
  anthropic: Anthropic,
  source: ClaimedSource,
  signal: AbortSignal,
  local: LocalTime,
): Promise<{ outcome: Outcome; found: number }> {
  const { store } = deps;
  const ref = sourceRef(source);
  try {
    const view = await viewOf(store, source, local);
    if (!view) {
      await store.finishSource(ref, [], null);
      return { outcome: "next", found: 0 };
    }
    const hooks = paidHooks(deps, view.itemId, (spend) => capState(spend, deps.budgetUsd).detection);
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
      const detected = await detectIdeas({ ...ctx, text: view.text, kind: view.prompt });
      saved = { ideas: detected.ideas.map((i) => ({ ...i, outcome: null })), model: detected.model };
      // Saved before anything is filed, so a retry files the same ideas at the same indexes without asking again.
      if (saved.ideas.length) await store.saveIdeas(ref, saved.ideas, saved.model);
    }
    const ideas = saved.ideas;
    const ownIds = new Set(ideas.flatMap((i) => (i.outcome && i.outcome.kind !== "mention" ? [i.outcome.id] : [])));
    const open = ideas.some((i) => !i.outcome) ? (await store.openIdeaTitles()).filter((o) => !ownIds.has(o.id) && o.id !== view.itemId) : [];
    const moveWhole = source.kind === "capture" && ideas.length === 1 && ideas[0].whole_item && ideas[0].sure ? source.itemId : null;
    for (const [n, idea] of ideas.entries()) {
      if (idea.outcome) continue;
      const { matchId } = open.length ? await sameIdea({ ...ctx, candidate: `${idea.title}\n${idea.quote}`, open }) : { matchId: null };
      const recordedOn = local.day(view.recorded);
      if (matchId) {
        await store.mentionAgain(matchId, view.mentionedIn, recordedOn, idea.quote);
        idea.outcome = { kind: "mention", id: matchId };
      } else if (moveWhole && (await store.moveCaptureToIdeas(moveWhole, recordedOn))) {
        idea.outcome = { kind: "moved", id: moveWhole };
      } else {
        idea.outcome = { kind: "new", id: await store.addIdeaFrom(view.origin, n, idea.title, idea.quote) };
      }
      if (n < ideas.length - 1) await store.saveIdeas(ref, ideas, saved.model);
    }
    await store.finishSource(ref, ideas, saved.model);
    return { outcome: "next", found: ideas.length };
  } catch (e) {
    // At the detection cap the source stays pending for next month or a higher cap; nothing is lost.
    if (e instanceof CapReached) {
      await store.releaseSource(ref);
      return { outcome: "stop", found: 0 };
    }
    if (e instanceof ClaimLost) {
      console.error(`ideas detection for ${ref} lost its claim before saving`);
      return { outcome: "next", found: 0 };
    }
    const code = failCode(e, signal);
    console.error(`ideas detection failed for ${ref}: ${code}`);
    if (isPassing(e, signal)) {
      await store.releaseSource(ref);
      return { outcome: "stop", found: 0 };
    }
    await store.failSource(ref, code);
    return { outcome: signal.aborted ? "stop" : "next", found: 0 };
  }
}

async function detectStep(deps: IdeasJobDeps, startedAt: number): Promise<number> {
  const anthropic = deps.anthropic;
  if (!anthropic) return 0;
  // IDEAS_MEMO_DETECTION only gates queueing in the relay; a memo already queued is always read, or its ideas would be stranded.
  const kinds: DetectKind[] = ["capture", "memo", "recording"];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, startedAt + DETECT_ABORT_MS - deps.now().getTime()));
  let found = 0;
  let local: LocalTime | null = null;
  try {
    while (deps.now().getTime() < startedAt + DETECT_BUDGET_MS) {
      const source = await deps.store.claimSource(kinds);
      if (!source) break;
      local ??= localTime(await deps.timeZone(), deps.now());
      const done = await detectOne(deps, anthropic, source, controller.signal, local);
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
  if (deps.resurface) {
    // A calendar or database failure here must not stop the daily failure message.
    try {
      result.resurfaced = await deps.resurface();
    } catch (e) {
      console.error(`ideas resurface failed: ${(e as { code?: string }).code ?? (e as Error).name}`);
    }
  }
  await notifyFailures(deps);
  return result;
}
