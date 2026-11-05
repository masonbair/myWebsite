import type { HubWorker } from "./worker-api";
import type { Item } from "./types";

const SUFFIX = " (late)";

export type LateTask = { id: string; title: string; quote: string; due: string | null; todo: boolean };

/** Open HiDock items still carrying the old " (late)" title suffix from todo-hub. */
export function lateTasks(items: Pick<Item, "id" | "title" | "description" | "labels" | "due">[]): LateTask[] {
  return items
    .filter((t) => t.labels.includes("hidock") && t.title.endsWith(SUFFIX))
    .map((t) => ({
      id: t.id,
      title: t.title,
      quote: t.description.split("\n").find((l) => l.startsWith("> "))?.slice(2) ?? "",
      due: t.due?.date ?? null,
      todo: !t.labels.includes("idea") && !t.labels.includes("thought"),
    }));
}

/** One-time clean-up: drop " (late)"; to-dos wait for scheduling, keeping the date only when `keep` has their id. */
export async function migrateLate(hub: HubWorker, keep: Set<string>): Promise<string[]> {
  const items = await hub.view("hidock");
  const lines: string[] = [];
  for (const late of lateTasks(items)) {
    const item = items.find((x) => x.id === late.id)!;
    const title = item.title.slice(0, -SUFFIX.length);
    const labels = late.todo ? [...item.labels, "to-schedule"] : item.labels;
    const kept = late.todo && keep.has(item.id);
    await hub.updateItem(item.id, kept ? { title, labels } : { title, labels, due: null });
    lines.push(`${kept ? "kept date" : "cleared date"} ${item.id} ${title}`);
  }
  return lines;
}
