import { CLAUDE_LABEL as CLAUDE, STATUS_LABELS } from "./rules";
import type { Item, StatusLabel } from "./types";

const STATUS: readonly string[] = STATUS_LABELS;
export const STALE_MS = 2 * 60 * 60 * 1000;

const withoutStatus = (labels: string[]) => labels.filter((l) => l !== CLAUDE && !STATUS.includes(l));

/** Approved by Mason, still open, and not held by a live run. */
export function isClaimable(item: Pick<Item, "labels" | "updatedAt" | "state">, now: Date): boolean {
  if (item.state !== "open" || !item.labels.includes(CLAUDE)) return false;
  if (!item.labels.includes("claude-working")) return true;
  return now.getTime() - Date.parse(item.updatedAt) > STALE_MS;
}

export function claimLabels(labels: string[]): string[] {
  const approved = labels.includes(CLAUDE) ? [CLAUDE] : [];
  return [...withoutStatus(labels), ...approved, "claude-working"];
}

// Dropping claude here is what stops a finished item being claimed again; the database allows it only in this write.
export function finishLabels(labels: string[]): string[] {
  return [...withoutStatus(labels), "claude-done"];
}

export function blockLabels(labels: string[]): string[] {
  return [...withoutStatus(labels), "claude-question"];
}

export function labelsForStatus(status: StatusLabel, labels: string[]): string[] {
  if (status === "claude-working") return claimLabels(labels);
  return status === "claude-done" ? finishLabels(labels) : blockLabels(labels);
}
