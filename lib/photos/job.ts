import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError } from "@anthropic-ai/sdk";
import type { ClaudeUsage, ModelId } from "@/lib/ai/claude";
import { labelPhoto, LabelError, shrinkForLabel, type PhotoLabel } from "./label";

export const MAX_LABEL_ATTEMPTS = 3;
const DEFAULT_CAP_USD = 1;
// Each run handles at most this many, so one big album upload spreads over a few runs instead of one long one.
const PER_RUN = 25;

export type UnlabeledPhoto = { assetId: string; path: string };

export type PhotoLabelStore = {
  /** Newest first: not hidden, not labeled, fewer than MAX_LABEL_ATTEMPTS failed tries. */
  unlabeled(limit: number): Promise<UnlabeledPhoto[]>;
  /** null when the file is missing. */
  download(path: string): Promise<Uint8Array | null>;
  saveLabel(assetId: string, label: PhotoLabel, at: Date): Promise<void>;
  /** Adds one to the photo's failed tries and notes why. */
  recordFailure(assetId: string, reason: string): Promise<void>;
  recordUsage(row: { model: ModelId; itemId: string; usage: ClaudeUsage }): Promise<void>;
  /** This UTC month's photo label spend in USD. */
  spend(now: Date): Promise<number>;
};

export type PhotoJobDeps = {
  store: PhotoLabelStore;
  anthropic: Anthropic | null;
  now: () => Date;
  cap: number;
  deadlineMs: number;
  label?: typeof labelPhoto;
};

export type PhotoJobResult = { labeled: string[]; failed: string[]; capped: boolean };

/** PHOTOS_MONTHLY_BUDGET_USD when it is a number of zero or more, otherwise $1. */
export function photoCapUsd(env: Record<string, string | undefined>): number {
  const raw = env.PHOTOS_MONTHLY_BUDGET_USD?.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return DEFAULT_CAP_USD;
  return Number(raw);
}

// Rate limits, overload and network errors pass on their own, so they must not use up a photo's tries.
function isPassing(e: unknown): boolean {
  if (e instanceof APIConnectionError) return true;
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && (status === 408 || status === 409 || status === 429 || status >= 500);
}

/** Labels the newest unlabeled photos until the run's deadline or the month's cap. */
export async function runPhotoLabelJob(deps: PhotoJobDeps): Promise<PhotoJobResult> {
  const result: PhotoJobResult = { labeled: [], failed: [], capped: false };
  if (!deps.anthropic) return result;
  const { store } = deps;
  const started = deps.now().getTime();
  const label = deps.label ?? labelPhoto;

  for (const photo of await store.unlabeled(PER_RUN)) {
    if (deps.now().getTime() - started > deps.deadlineMs) break;
    if ((await store.spend(deps.now())) >= deps.cap) {
      result.capped = true;
      break;
    }
    try {
      const bytes = await store.download(photo.path);
      if (!bytes) throw new LabelError("image");
      const { label: value, usage, model } = await label(deps.anthropic, await shrinkForLabel(bytes));
      await store.recordUsage({ model, itemId: photo.assetId, usage });
      await store.saveLabel(photo.assetId, value, deps.now());
      result.labeled.push(photo.assetId);
    } catch (e) {
      if (e instanceof LabelError && e.charge) await store.recordUsage({ ...e.charge, itemId: photo.assetId });
      if (isPassing(e)) {
        console.error(`photos: ${photo.assetId} will retry: ${(e as Error).name}`);
        break;
      }
      const reason = e instanceof LabelError ? e.reason : "error";
      await store.recordFailure(photo.assetId, reason);
      result.failed.push(photo.assetId);
    }
  }
  return result;
}
