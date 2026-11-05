import type { Item, ItemPatch } from "./types";

const LISTS: readonly Item["list"][] = ["inbox", "todo", "ideas"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const LABEL_PATTERN = /^[a-z0-9_:-]+$/;
export const MAX_TITLE = 500;
export const MAX_LABEL_LENGTH = 60;
const MAX_LABELS = 50;
export const MAX_DESCRIPTION = 10_000;
export const MAX_COMMENT = 10_000;
// Worker write-ups (research, plans) run longer than anything typed in the hub UI.
export const MAX_WORKER_COMMENT = 50_000;

function fail(message: string): never {
  throw new Error(`bad item patch: ${message}`);
}

function parseDue(raw: unknown): Item["due"] {
  if (raw === null) return null;
  const due = raw as { date?: unknown; time?: unknown };
  if (typeof due !== "object" || typeof due.date !== "string" || !DATE.test(due.date)) fail("due.date");
  // Date rolls 2026-02-31 over to March 3, so a real day must come back unchanged.
  const day = new Date(`${due.date}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== due.date) fail("due.date");
  const time = due.time ?? null;
  if (time !== null && (typeof time !== "string" || !TIME.test(time))) fail("due.time");
  return { date: due.date, time };
}

/** New labels are lowercased; anything left that is not a-z, 0-9, -, _ or : is refused. */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Checks a patch sent from the browser; server actions are open POST endpoints, so nothing is trusted.
 * @param existingLabels labels already on the item, kept as they are so imported project labels never block an edit.
 */
export function parseItemPatch(raw: unknown, existingLabels: string[] = []): ItemPatch {
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const input = raw as Record<string, unknown>;
  const patch: ItemPatch = {};
  if (input.title !== undefined) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > MAX_TITLE) fail("title");
    patch.title = title;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > MAX_DESCRIPTION) fail("description");
    patch.description = input.description;
  }
  if (input.labels !== undefined) {
    if (!Array.isArray(input.labels) || input.labels.length > MAX_LABELS) fail("labels");
    const labels = input.labels.map((label) => {
      if (typeof label !== "string") fail("labels");
      if (existingLabels.includes(label)) return label;
      const clean = normalizeLabel(label);
      if (!LABEL_PATTERN.test(clean) || clean.length > MAX_LABEL_LENGTH) fail(`label ${JSON.stringify(label)}`);
      return clean;
    });
    patch.labels = [...new Set(labels)];
  }
  if (input.list !== undefined) {
    if (!LISTS.includes(input.list as Item["list"])) fail("list");
    patch.list = input.list as Item["list"];
  }
  if (input.due !== undefined) patch.due = parseDue(input.due);
  return patch;
}
