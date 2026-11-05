import { describe, expect, it } from "vitest";
import { listMemos, parseMemo, parsePieces, planPieces, splitMemo, type Memo, type Pieces } from "@/lib/hub/memo-split";
import { memoItem } from "@/lib/hub/memo";
import type { Comment, Item } from "@/lib/hub/types";
import { seedItem, workerHarness } from "./worker-harness";

const FILE = "2026Oct22-183504-Rec22.hda";
const RECORDED = "2026-10-22T18:35:04";
const PROJECTS = ["todo-hub", "ledger"];
const memo: Memo = { id: "m1", file: FILE, recorded: RECORDED, transcript: "t" };
const empty: Pieces = { todos: [], notes: [], ideas: [] };
const footer = `Source: HiDock ${FILE}, recorded ${RECORDED}\nhidock-file: ${FILE}`;
const todo = (date: string | null, time: string | null = null, project: string | null = null) => ({
  text: "Call the dentist",
  source: "I need to call the dentist.",
  date,
  time,
  project,
});

let commentSeq = 0;
const comment = (body: string, author: Comment["author"] = "worker"): Comment => ({
  id: `c${++commentSeq}`,
  itemId: "m1",
  body,
  author,
  createdAt: "2026-10-26T10:00:00Z",
});

/** A memo item exactly as the relay files it, put straight into the harness rows. */
function seedMemo(h: ReturnType<typeof workerHarness>, transcript = "Call the dentist. Idea: a costume app.") {
  const m = memoItem({ file: FILE, recorded: RECORDED, transcript });
  const item = seedItem(h.rows, { title: m.title, description: m.description, labels: ["hidock-memo"], source: "memo:phone" });
  for (const body of m.transcriptParts) h.rows.comments.push({ ...comment(body), itemId: item.id });
  return item;
}

describe("parseMemo", () => {
  it("joins the worker's numbered transcript parts and ignores other comments", () => {
    const item = { id: "m1", description: footer } as Item;
    const comments = [
      comment("transcript (part 3 of 3):\n part three"),
      comment("merged into something"),
      comment("transcript (part 1 of 3):\npart one"),
      comment("transcript (part 2 of 3):\n part two"),
      comment("transcript (part 2 of 3):\n part two"),
      comment("transcript (part 4 of 3):\n not from the relay", "mason"),
    ];
    expect(parseMemo(item, comments)).toEqual({ id: "m1", file: FILE, recorded: RECORDED, transcript: "part one part two part three" });
  });

  it("still reads a memo when Mason added a line after the footer", () => {
    const item = { id: "m1", description: `${footer}\n\nmy note` } as Item;
    expect(parseMemo(item, [comment("transcript (part 1 of 1):\nhi")])).toMatchObject({ file: FILE, recorded: RECORDED, transcript: "hi" });
  });

  it("throws on an item that isn't a memo or has no transcript", () => {
    expect(() => parseMemo({ id: "x", description: "hello" } as Item, [])).toThrow(/not a HiDock memo/);
    expect(() => parseMemo({ id: "x", description: footer } as Item, [])).toThrow(/no transcript/);
  });
});

describe("parsePieces", () => {
  it("rejects a missing todos array", () => {
    expect(() => parsePieces({ notes: [], ideas: [] }, PROJECTS)).toThrow(/todos/);
  });

  it("rejects a badly formatted date", () => {
    expect(() => parsePieces({ ...empty, todos: [todo("Oct 25")] }, PROJECTS)).toThrow(/date/);
  });

  it("turns a note for an unknown project into an idea", () => {
    const p = parsePieces({ ...empty, notes: [{ text: "n", source: "s", project: "nope" }] }, PROJECTS);
    expect(p.notes).toEqual([]);
    expect(p.ideas).toEqual([{ text: "n", source: "s" }]);
  });

  it("drops an unknown project from a to-do", () => {
    expect(parsePieces({ ...empty, todos: [todo(null, null, "nope")] }, PROJECTS).todos[0].project).toBeNull();
  });
});

describe("planPieces", () => {
  const plan = (pieces: Partial<Pieces>) => planPieces(memo, { ...empty, ...pieces });

  it("files an undated to-do with no due date, waiting to be scheduled", () => {
    const [p] = plan({ todos: [todo(null)] });
    expect(p).toEqual({
      ref: `${FILE}#todo:0`,
      title: "Call the dentist",
      description: `> I need to call the dentist.\n\nSource: HiDock ${FILE}, recorded ${RECORDED}\nhinote-ref: ${FILE}#todo:0`,
      labels: ["hidock", "to-schedule"],
      due: null,
    });
  });

  it("keeps a named day and time, and still waits for an estimate", () => {
    const [p] = plan({ todos: [todo("2026-10-25", "14:00")] });
    expect(p.due).toEqual({ date: "2026-10-25", time: "14:00" });
    expect(p.labels).toContain("to-schedule");
  });

  it("keeps a past date as stated, without (late)", () => {
    const [p] = plan({ todos: [todo("2026-10-20")] });
    expect(p.due).toEqual({ date: "2026-10-20", time: null });
    expect(p.title).toBe("Call the dentist");
  });

  it("gives a project note the project label and no due date", () => {
    const [p] = plan({ notes: [{ text: "n", source: "s", project: "todo-hub" }] });
    expect(p.ref).toBe(`${FILE}#note:0`);
    expect(p.labels).toEqual(["hidock", "todo-hub"]);
    expect(p.due).toBeNull();
  });

  it("gives an idea only the hidock label", () => {
    const [p] = plan({ ideas: [{ text: "i", source: "s" }] });
    expect(p.ref).toBe(`${FILE}#idea:0`);
    expect(p.labels).toEqual(["hidock"]);
  });

  it("labels a project to-do with its project", () => {
    expect(plan({ todos: [todo(null, null, "ledger")] })[0].labels).toEqual(["hidock", "ledger", "to-schedule"]);
  });
});

describe("listMemos", () => {
  it("reads open memos and skips one that can't be read", async () => {
    const h = workerHarness();
    const good = seedMemo(h, "x".repeat(20_000));
    const broken = seedItem(h.rows, { labels: ["hidock-memo"], description: "edited away" });
    const { memos, skipped } = await listMemos(h.hub);
    expect(memos).toEqual([{ id: good.id, file: FILE, recorded: RECORDED, transcript: "x".repeat(20_000) }]);
    expect(skipped).toEqual([broken.id]);
  });
});

describe("splitMemo", () => {
  const pieces: Pieces = {
    todos: [todo("2026-10-25")],
    notes: [],
    ideas: [{ text: "Costume app", source: "Idea: a costume app." }],
  };
  const filed = (h: ReturnType<typeof workerHarness>) => [...h.rows.items.values()].filter((i) => i.labels.includes("hidock"));

  it("files pieces as hidock inbox items, then archives the memo as memo-split, never done", async () => {
    const h = workerHarness();
    const item = seedMemo(h);
    expect(await splitMemo(h.hub, item.id, pieces)).toBe(2);
    const added = filed(h);
    expect(added.map((i) => [i.title, i.list, i.state, i.labels, i.due])).toEqual([
      ["Call the dentist", "inbox", "open", ["hidock", "to-schedule"], { date: "2026-10-25", time: null }],
      ["Costume app", "inbox", "open", ["hidock"], null],
    ]);
    const after = h.rows.items.get(item.id)!;
    expect(after.state).toBe("archived");
    expect(after.mergedInto).toBeNull();
    expect(h.rows.archivedReasons.get(item.id)).toBe("memo-split");
    const note = h.rows.comments.filter((c) => c.itemId === item.id).at(-1)!.body;
    expect(note).toBe(`split into 2 items:\n${added.map((i) => i.url).join("\n")}`);
  });

  it("retried after a crash before the archive, files no piece twice", async () => {
    let failArchive = true;
    const h = workerHarness();
    const item = seedMemo(h);
    const flaky = { ...h.hub, archiveSplitMemo: async (id: string, note: string) => {
      if (failArchive) throw new Error("hub 500");
      return h.hub.archiveSplitMemo(id, note);
    } };
    await expect(splitMemo(flaky, item.id, pieces)).rejects.toThrow("hub 500");
    expect(filed(h)).toHaveLength(2);
    expect(h.rows.items.get(item.id)!.state).toBe("open");
    failArchive = false;
    expect(await splitMemo(flaky, item.id, pieces)).toBe(2);
    expect(filed(h)).toHaveLength(2);
    expect(h.rows.items.get(item.id)!.state).toBe("archived");
  });

  it("does not re-file a piece Mason already finished", async () => {
    const h = workerHarness();
    const item = seedMemo(h);
    await expect(splitMemo({ ...h.hub, archiveSplitMemo: async () => Promise.reject(new Error("down")) }, item.id, pieces)).rejects.toThrow();
    const [first] = filed(h);
    h.rows.items.set(first.id, { ...first, state: "done" });
    await splitMemo(h.hub, item.id, pieces);
    expect(filed(h)).toHaveLength(2);
  });

  it("archives a memo with nothing to file, with a note saying so", async () => {
    const h = workerHarness();
    const item = seedMemo(h);
    expect(await splitMemo(h.hub, item.id, empty)).toBe(0);
    expect(h.rows.items.get(item.id)!.state).toBe("archived");
    expect(h.rows.comments.filter((c) => c.itemId === item.id).at(-1)!.body).toBe("nothing to file from this memo");
  });

  it("running again on an archived memo changes nothing", async () => {
    const h = workerHarness();
    const item = seedMemo(h);
    await splitMemo(h.hub, item.id, pieces);
    const comments = h.rows.comments.length;
    expect(await splitMemo(h.hub, item.id, pieces)).toBe(2);
    expect(h.rows.comments).toHaveLength(comments);
    expect(filed(h)).toHaveLength(2);
  });
});
