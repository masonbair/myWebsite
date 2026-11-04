import type { Actor, ArchiveReason, HubAction } from "./types";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const CLAUDE_LABEL = "claude";
export const STATUS_LABELS = ["claude-working", "claude-done", "claude-question"] as const;

const ALLOWED: Record<HubAction, Actor["kind"][]> = {
  read: ["mason", "worker", "agent"],
  add: ["mason", "worker", "agent"],
  update: ["mason", "worker", "agent"],
  comment: ["mason", "worker", "agent"],
  complete: ["mason"],
  reopen: ["mason"],
  archive: ["mason", "worker", "agent"],
  claim: ["worker"],
  "set-status-labels": ["worker"],
};

export function assertAllowed(actor: Actor, action: HubAction): void {
  if (!ALLOWED[action].includes(actor.kind)) {
    throw new ForbiddenError(`${actor.kind} may not ${action}`);
  }
}

function symmetricDifference(a: string[], b: string[]): string[] {
  const left = new Set(a);
  const right = new Set(b);
  return [...left].filter((x) => !right.has(x)).concat([...right].filter((x) => !left.has(x)));
}

/** Only Mason may add or remove `claude` or change a status label through a plain update. */
export function assertLabelChangeAllowed(actor: Actor, before: string[], after: string[]): void {
  if (actor.kind === "mason") return;
  const protectedLabels: string[] = [CLAUDE_LABEL, ...STATUS_LABELS];
  const touched = symmetricDifference(before, after).filter((label) => protectedLabels.includes(label));
  if (touched.length > 0) {
    throw new ForbiddenError(`${actor.kind} may not change the label ${touched[0]}`);
  }
}

export function assertStatusLabels(labels: string[]): void {
  const allowed: string[] = [...STATUS_LABELS];
  const bad = labels.find((label) => !allowed.includes(label));
  if (bad !== undefined) throw new ForbiddenError(`${bad} is not a status label`);
}

export function assertArchiveArgs(reason: ArchiveReason, mergedInto: string | null, itemId: string): void {
  if (reason === "merged" && mergedInto === null) {
    throw new ForbiddenError("a merged item needs the item it was merged into");
  }
  if (mergedInto !== null && mergedInto === itemId) {
    throw new ForbiddenError("an item cannot be merged into itself");
  }
}

export function auditActor(actor: Actor): string {
  if (actor.kind === "worker") return `worker:${actor.runId}`;
  if (actor.kind === "agent") return `agent:${actor.client}`;
  return "mason";
}
