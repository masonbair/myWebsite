import { formatDue, formatInstantIn, LIST_NAMES } from "./format";
import type { Comment, Item } from "./types";

const AUTHORS: Record<Comment["author"], string> = { mason: "Mason", worker: "Hub worker (AI)", agent: "AI agent" };

/** An item and its comments as one Markdown task brief to paste into a Claude session. */
export function itemBrief(item: Item, comments: Comment[], timeZone: string): string {
  const facts = [
    `List: ${LIST_NAMES[item.list]}`,
    formatDue(item.due),
    item.labels.length > 0 ? `Labels: ${item.labels.join(", ")}` : null,
    `Hub item: ${item.url} (id ${item.id})`,
  ].filter(Boolean);

  const parts = [`# Task: ${item.title}`, facts.map((fact) => `- ${fact}`).join("\n")];
  if (item.description.trim()) parts.push(`## Details\n\n${item.description.trim()}`);
  if (comments.length > 0) {
    const thread = comments.map((c) => {
      const when = formatInstantIn(c.createdAt, timeZone) ?? c.createdAt;
      return `### ${AUTHORS[c.author]}, ${when}\n\n${c.body.trim()}`;
    });
    parts.push(`## Comments (oldest first)\n\n${thread.join("\n\n")}`);
  }
  return `${parts.join("\n\n")}\n`;
}
