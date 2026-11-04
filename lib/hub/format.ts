import type { Item } from "./types";

export const LIST_NAMES: Record<Item["list"], string> = { inbox: "Inbox", todo: "Todo", ideas: "Ideas" };

export function listHref(list: Item["list"]): string {
  return list === "inbox" ? "/hub" : `/hub/list/${list}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isItemId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// Due dates are calendar days, so they are read and printed in UTC to stop a timezone shifting the day.
export function formatDue(due: Item["due"]): string | null {
  if (!due) return null;
  const day = new Date(`${due.date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return null;
  const date = day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (!due.time) return `Due ${date}`;
  const [hours, minutes] = due.time.split(":").map(Number);
  const clock = new Date(Date.UTC(2000, 0, 1, hours, minutes)).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `Due ${date}, ${clock}`;
}

/** What Claude is waiting on Mason for, or null when nothing is. */
export function needsYouReason(labels: string[]): string | null {
  if (labels.includes("claude-question")) return "Claude has a question";
  if (labels.includes("claude-done")) return "Claude finished, check the result";
  return null;
}
