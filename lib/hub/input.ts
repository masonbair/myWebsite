import type { Item, ItemPatch } from "./types";

const LISTS: readonly Item["list"][] = ["inbox", "todo", "ideas"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const MAX_TITLE = 500;
const MAX_LABEL = 60;
export const MAX_COMMENT = 10_000;

function fail(message: string): never {
  throw new Error(`bad item patch: ${message}`);
}

function parseDue(raw: unknown): Item["due"] {
  if (raw === null) return null;
  const due = raw as { date?: unknown; time?: unknown };
  if (typeof due !== "object" || typeof due.date !== "string" || !DATE.test(due.date)) fail("due.date");
  if (Number.isNaN(Date.parse(`${due.date}T00:00:00Z`))) fail("due.date");
  const time = due.time ?? null;
  if (time !== null && (typeof time !== "string" || !TIME.test(time))) fail("due.time");
  return { date: due.date, time };
}

/** Checks a patch sent from the browser; server actions are open POST endpoints, so nothing is trusted. */
export function parseItemPatch(raw: unknown): ItemPatch {
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const input = raw as Record<string, unknown>;
  const patch: ItemPatch = {};
  if (input.title !== undefined) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > MAX_TITLE) fail("title");
    patch.title = title;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string") fail("description");
    patch.description = input.description;
  }
  if (input.labels !== undefined) {
    if (!Array.isArray(input.labels)) fail("labels");
    const labels = input.labels.map((label) => (typeof label === "string" ? label.trim() : ""));
    if (labels.some((label) => !label || label.length > MAX_LABEL)) fail("labels");
    patch.labels = [...new Set(labels)];
  }
  if (input.list !== undefined) {
    if (!LISTS.includes(input.list as Item["list"])) fail("list");
    patch.list = input.list as Item["list"];
  }
  if (input.due !== undefined) patch.due = parseDue(input.due);
  return patch;
}
