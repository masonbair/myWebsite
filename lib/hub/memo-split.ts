import { isCalendarDate, isClockTime } from "./input";
import { TRANSCRIPT_PART } from "./memo";
import type { Comment, Item } from "./types";
import type { HubWorker, MemoItem } from "./worker-api";

export type Memo = { id: string; file: string; recorded: string; transcript: string };
/** A memo for the worker, with the idea items the Ideas Lab already filed from it. */
export type ListedMemo = Memo & { ideasOwnedByIdeasLab: boolean; ideasFiled: string[] };

export type Pieces = {
  todos: { text: string; source: string; date: string | null; time: string | null; project: string | null }[];
  notes: { text: string; source: string; project: string }[];
  ideas: { text: string; source: string }[];
};

export type PlannedPiece = { ref: string; title: string; description: string; labels: string[]; due: Item["due"] };

const FOOTER = /Source: HiDock (\S+), recorded (\S+)\nhidock-file: (\S+)/;
const isPieceTime = (v: unknown) => isClockTime(v) && v.length === 5;

/** Read a memo item back into the upload it came from; only the relay's own worker comments count as transcript. */
export function parseMemo(item: Pick<Item, "id" | "description">, comments: Comment[]): Memo {
  const footer = item.description.match(FOOTER);
  if (!footer) throw new Error(`item ${item.id} is not a HiDock memo`);
  const parts = new Map<number, string>();
  for (const c of comments) {
    const part = c.author === "worker" ? c.body.match(TRANSCRIPT_PART) : null;
    if (part) parts.set(Number(part[1]), c.body.slice(part[0].length));
  }
  if (parts.size === 0) throw new Error(`memo ${item.id} has no transcript`);
  const transcript = [...parts.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join("");
  return { id: item.id, file: footer[3], recorded: footer[2], transcript };
}

function text(v: unknown, where: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${where} must be a non-empty string`);
  return v;
}

function optional(v: unknown, valid: (v: unknown) => boolean, where: string, shape: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !valid(v)) throw new Error(`${where} must be null or a real ${shape}`);
  return v;
}

function list(data: Record<string, unknown>, key: keyof Pieces): Record<string, unknown>[] {
  const v = data[key];
  if (!Array.isArray(v)) throw new Error(`pieces.${key} must be an array`);
  return v.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new Error(`pieces.${key}[${i}] must be an object`);
    return item as Record<string, unknown>;
  });
}

/** The Ideas Lab owns a memo's ideas while its detection is queued or done; then the memo split files none of its own. */
export const ideasOwnedOf = (item: Item) => (item as Partial<MemoItem>).ideasOwnedByIdeasLab ?? false;

/**
 * Check the worker's pieces JSON. A note for an unknown project becomes an idea; a to-do loses an unknown project.
 * @param ideasOwned the Ideas Lab owns this memo's ideas, so the worker's own ideas list is dropped.
 */
export function parsePieces(json: unknown, projects: string[], ideasOwned = false): Pieces {
  if (typeof json !== "object" || json === null) throw new Error("pieces must be an object");
  const data = json as Record<string, unknown>;
  const known = (p: unknown) => (typeof p === "string" && projects.includes(p) ? p : null);
  const out: Pieces = { todos: [], notes: [], ideas: [] };
  list(data, "todos").forEach((t, i) =>
    out.todos.push({
      text: text(t.text, `todos[${i}].text`),
      source: text(t.source, `todos[${i}].source`),
      date: optional(t.date, isCalendarDate, `todos[${i}].date`, "YYYY-MM-DD date"),
      time: optional(t.time, isPieceTime, `todos[${i}].time`, "HH:MM time"),
      project: known(t.project),
    }),
  );
  list(data, "notes").forEach((n, i) => {
    const piece = { text: text(n.text, `notes[${i}].text`), source: text(n.source, `notes[${i}].source`) };
    const project = known(n.project);
    if (project) out.notes.push({ ...piece, project });
    else out.ideas.push(piece);
  });
  const ideas = list(data, "ideas").map((d, i) => ({ text: text(d.text, `ideas[${i}].text`), source: text(d.source, `ideas[${i}].source`) }));
  // Only the worker's own ideas list is dropped; a note for an unknown project is still filed.
  if (!ideasOwned) out.ideas.push(...ideas);
  return out;
}

/** The inbox items for one memo, in hinote-sync's format. To-dos wait for the worker's scheduling step. */
export function planPieces(memo: Memo, pieces: Pieces): PlannedPiece[] {
  const piece = (kind: string, i: number, title: string, source: string, labels: string[]): PlannedPiece => {
    const ref = `${memo.file}#${kind}:${i}`;
    return {
      ref,
      title,
      description: `> ${source}\n\nSource: HiDock ${memo.file}, recorded ${memo.recorded}\nhinote-ref: ${ref}`,
      labels: ["hidock", ...labels],
      due: null,
    };
  };
  return [
    ...pieces.todos.map((t, i) => {
      const p = piece("todo", i, t.text, t.source, t.project ? [t.project, "to-schedule"] : ["to-schedule"]);
      return t.date ? { ...p, due: { date: t.date, time: t.time } } : p;
    }),
    ...pieces.notes.map((n, i) => piece("note", i, n.text, n.source, [n.project])),
    ...pieces.ideas.map((d, i) => piece("idea", i, d.text, d.source, [])),
  ];
}

/** Open memos, plus the ids of memo items that can't be read, so one edited item doesn't block the rest. */
export async function listMemos(hub: HubWorker): Promise<{ memos: ListedMemo[]; skipped: string[] }> {
  const memos: ListedMemo[] = [];
  const skipped: string[] = [];
  for (const item of await hub.view("memos")) {
    try {
      memos.push({ ...parseMemo(item, await hub.listComments(item.id)), ideasOwnedByIdeasLab: ideasOwnedOf(item), ideasFiled: (item as Partial<MemoItem>).ideasFiled ?? [] });
    } catch {
      skipped.push(item.id);
    }
  }
  return { memos, skipped };
}

/** File each piece, then archive the memo; a re-run files nothing twice because each piece's hinote-ref is its client key. */
export async function splitMemo(hub: HubWorker, id: string, pieces: Pieces): Promise<number> {
  const item = await hub.getItem(id);
  if (!item) throw new Error(`no item ${id}`);
  if (item.state === "done") throw new Error(`memo ${id} is done; nothing was filed`);
  const planned = planPieces(parseMemo(item, await hub.listComments(id)), pieces);
  const filed: Item[] = [];
  for (const { ref, ...piece } of planned) filed.push(await hub.addItem({ ...piece, clientKey: `hidock:${ref}` }));
  const note = filed.length
    ? `split into ${filed.length} items:\n${filed.map((i) => i.url).join("\n")}`
    : "nothing to file from this memo";
  await hub.archiveSplitMemo(id, note);
  return planned.length;
}
