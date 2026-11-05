import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliDeps } from "@/lib/hub/cli";
import type { Message } from "@/lib/hub/notify";
import type { HubStore, Item } from "@/lib/hub/types";
import { minutesAgo, NOW, seedItem, workerHarness } from "./worker-harness";

function tempFile(text = "Three costume ideas\nDetails...") {
  const file = join(mkdtempSync(join(tmpdir(), "hub-")), "f.txt");
  writeFileSync(file, text);
  return file;
}

type Overrides = { notify?: () => never; store?: Partial<HubStore> };

function harness(overrides: Overrides = {}) {
  const api = workerHarness(overrides.store);
  const sent: Message[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    hub: api.hub,
    notify: overrides.notify ?? (async (m) => void sent.push(m)),
    now: () => NOW,
    timeZone: "America/Denver",
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  const item = (id: string) => api.rows.items.get(id)!;
  const commentsOn = (id: string) => api.rows.comments.filter((c) => c.itemId === id).map((c) => c.body);
  return { ...api, deps, sent, out, err, item, commentsOn };
}

describe("runCli", () => {
  it("setup is a health check", async () => {
    const h = harness();
    expect(await runCli(["setup"], h.deps)).toBe(0);
    expect(h.out).toEqual(["ok"]);
  });

  describe("claim", () => {
    it("sets claim labels on a fresh claude item", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude"] });
      expect(await runCli(["claim", t.id], h.deps)).toBe(0);
      expect(h.item(t.id).labels).toEqual(["claude", "claude-working"]);
    });

    it("exits 3 without touching labels for an item taken 10 min ago", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"], updatedAt: minutesAgo(10) });
      expect(await runCli(["claim", t.id], h.deps)).toBe(3);
      expect(h.item(t.id).labels).toEqual(["claude", "claude-working"]);
      expect(h.err.join("")).toContain("not claimable");
    });

    it("two racing runs: one wins, the other exits 3", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude"] });
      const codes = await Promise.all([runCli(["claim", t.id], h.deps), runCli(["claim", t.id], h.deps)]);
      expect(codes.sort()).toEqual([0, 3]);
    });

    it("wins over a run that died over 2h ago", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"], updatedAt: minutesAgo(130) });
      expect(await runCli(["claim", t.id], h.deps)).toBe(0);
    });

    it("can claim a second pass after claude-done", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude", "claude-done"] });
      expect(await runCli(["claim", t.id], h.deps)).toBe(0);
      expect(h.item(t.id).labels).toEqual(["claude", "claude-working"]);
    });
  });

  describe("finish and block", () => {
    it("finish comments before changing labels, then notifies", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"] });
      expect(await runCli(["finish", t.id, "--comment-file", tempFile()], h.deps)).toBe(0);
      expect(h.log).toEqual([`comment ${t.id} Three costume ideas`, `status ${t.id} claude-done`]);
      expect(h.item(t.id).labels).toEqual(["claude-done"]);
      expect(h.sent).toEqual([{ title: "Done: Halloween costume", message: "Three costume ideas", clickUrl: t.url }]);
    });

    it("finish keeps the comment and exits 1 when the label change fails", async () => {
      const h = harness({
        store: {
          setStatusLabels: () => {
            throw new Error("db down");
          },
        },
      });
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"] });
      expect(await runCli(["finish", t.id, "--comment-file", tempFile()], h.deps)).toBe(1);
      expect(h.commentsOn(t.id)).toEqual(["Three costume ideas\nDetails..."]);
      expect(h.sent).toEqual([]);
      expect(h.err.join("")).toContain("500");
    });

    it("a retried finish does not post the same comment twice", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"] });
      h.rows.comments.push({ id: "c0", itemId: t.id, body: "Three costume ideas\nDetails...", author: "worker", createdAt: NOW.toISOString() });
      expect(await runCli(["finish", t.id, "--comment-file", tempFile()], h.deps)).toBe(0);
      expect(h.log).toEqual([`status ${t.id} claude-done`]);
    });

    it("finish exits 0 with a warning when notify fails", async () => {
      const h = harness({
        notify: () => {
          throw new Error("ntfy 429");
        },
      });
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"] });
      expect(await runCli(["finish", t.id, "--comment-file", tempFile()], h.deps)).toBe(0);
      expect(h.err.join("")).toContain("notify failed");
      expect(h.item(t.id).labels).toEqual(["claude-done"]);
    });

    it("block marks claude-question and titles the ping Question", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"] });
      expect(await runCli(["block", t.id, "--comment-file", tempFile()], h.deps)).toBe(0);
      expect(h.item(t.id).labels).toEqual(["claude-question"]);
      expect(h.sent[0].title).toBe("Question: Halloween costume");
    });

    it("finish on an item no run claimed exits 3 and changes nothing", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude"] });
      expect(await runCli(["finish", t.id, "--comment-file", tempFile()], h.deps)).toBe(3);
      expect(h.err.join("")).toContain("not claimed");
      expect(h.item(t.id).labels).toEqual(["claude"]);
      expect(h.sent).toEqual([]);
    });

    it("a write-up over 50,000 characters is refused before sending, naming the limit", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude", "claude-working"] });
      expect(await runCli(["finish", t.id, "--comment-file", tempFile("x".repeat(50_001))], h.deps)).toBe(2);
      expect(h.err.join("")).toContain("50000");
      expect(h.log).toEqual([]);
    });

    it("finish without --comment-file is a usage error", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["claude"] });
      expect(await runCli(["finish", t.id], h.deps)).toBe(2);
      expect(h.log).toEqual([]);
    });
  });

  describe("granola sweep state", () => {
    it("defaults to 48h ago when no sweep is recorded", async () => {
      const h = harness();
      expect(await runCli(["granola-since"], h.deps)).toBe(0);
      expect(h.out).toEqual([minutesAgo(48 * 60)]);
    });

    it("records the sweep time in hub state, then reads it back", async () => {
      const h = harness();
      expect(await runCli(["granola-done", "2026-10-23T11:00:00Z"], h.deps)).toBe(0);
      expect(await runCli(["granola-since"], h.deps)).toBe(0);
      expect(h.out).toEqual(["2026-10-23T11:00:00.000Z"]);
      expect([...h.rows.state.keys()]).toEqual(["granola-swept-until"]);
    });

    it("rejects a non-date", async () => {
      const h = harness();
      expect(await runCli(["granola-done", "yesterday"], h.deps)).toBe(2);
      expect(h.rows.state.size).toBe(0);
    });
  });

  it("approved prints only claimable items", async () => {
    const h = harness();
    const free = seedItem(h.rows, { labels: ["claude"], updatedAt: minutesAgo(5) });
    seedItem(h.rows, { labels: ["claude", "claude-working"], updatedAt: minutesAgo(5) });
    expect(await runCli(["approved"], h.deps)).toBe(0);
    expect(JSON.parse(h.out.join(""))).toEqual([
      { id: free.id, title: "Halloween costume", url: free.url, updatedAt: minutesAgo(5) },
    ]);
  });

  it("laptop lists open laptop items not yet done by claude", async () => {
    const h = harness();
    seedItem(h.rows, { labels: ["laptop"] });
    seedItem(h.rows, { labels: ["laptop", "claude-done"] });
    expect(await runCli(["laptop"], h.deps)).toBe(0);
    expect(JSON.parse(h.out.join(""))).toHaveLength(1);
  });

  it("alert sends a hub problem ping", async () => {
    const h = harness();
    expect(await runCli(["alert", "Granola", "signed", "out"], h.deps)).toBe(0);
    expect(h.sent).toEqual([{ title: "hub problem", message: "Granola signed out" }]);
  });

  it("unknown command exits 2 with usage", async () => {
    const h = harness();
    expect(await runCli(["nope"], h.deps)).toBe(2);
    expect(h.err.join("")).toContain("usage");
  });

  it("has no command that completes, reopens or deletes", async () => {
    const h = harness();
    const t = seedItem(h.rows, { labels: ["claude"] });
    for (const cmd of ["complete", "reopen", "delete", "done", "close"]) {
      expect(await runCli([cmd, t.id], h.deps)).toBe(2);
    }
    expect(h.item(t.id).state).toBe("open");
    expect(h.log).toEqual([]);
  });

  describe("inbox sorting", () => {
    it("inbox prints unsorted items, item and comments print one item", async () => {
      const h = harness();
      const raw = seedItem(h.rows, { title: "call bank" });
      seedItem(h.rows, { labels: ["todo"] });
      h.rows.comments.push({ id: "c1", itemId: raw.id, body: "note", author: "mason", createdAt: NOW.toISOString() });
      expect(await runCli(["inbox"], h.deps)).toBe(0);
      expect(JSON.parse(h.out[0]).map((i: Item) => i.id)).toEqual([raw.id]);
      expect(await runCli(["item", raw.id], h.deps)).toBe(0);
      expect(JSON.parse(h.out[1]).title).toBe("call bank");
      expect(await runCli(["comments", raw.id], h.deps)).toBe(0);
      expect(JSON.parse(h.out[2]).map((c: { body: string }) => c.body)).toEqual(["note"]);
    });

    it("sort adds the kind, project, laptop and due date, keeps every label, and moves the list", async () => {
      const h = harness();
      const t = seedItem(h.rows, { labels: ["hidock", "Old-Label"] });
      const args = ["sort", t.id, "--kind", "todo", "--project", "ledger", "--laptop", "--due", "2026-10-30"];
      expect(await runCli(args, h.deps)).toBe(0);
      expect(h.item(t.id)).toMatchObject({
        labels: ["hidock", "Old-Label", "todo", "ledger", "laptop"],
        list: "todo",
        due: { date: "2026-10-30", time: null },
      });
    });

    it("sort files ideas and thoughts under ideas", async () => {
      const h = harness();
      const idea = seedItem(h.rows);
      const thought = seedItem(h.rows);
      await runCli(["sort", idea.id, "--kind", "idea"], h.deps);
      await runCli(["sort", thought.id, "--kind", "thought"], h.deps);
      expect(h.item(idea.id)).toMatchObject({ labels: ["idea"], list: "ideas" });
      expect(h.item(thought.id)).toMatchObject({ labels: ["thought"], list: "ideas" });
    });

    it("sort refuses a bad kind, a bad date, and a date on a to-schedule item", async () => {
      const h = harness();
      const t = seedItem(h.rows);
      const waiting = seedItem(h.rows, { labels: ["to-schedule"] });
      expect(await runCli(["sort", t.id, "--kind", "chore"], h.deps)).toBe(2);
      expect(await runCli(["sort", t.id, "--kind", "todo", "--due", "Friday"], h.deps)).toBe(2);
      expect(await runCli(["sort", waiting.id, "--kind", "todo", "--due", "2026-10-30"], h.deps)).toBe(2);
      expect(h.log).toEqual([]);
    });

    it("merge archives the newer item into the older and copies the note", async () => {
      const h = harness();
      const older = seedItem(h.rows);
      const newer = seedItem(h.rows);
      expect(await runCli(["merge", newer.id, "--into", older.id, "--comment-file", tempFile("> quote\nSource: memo")], h.deps)).toBe(0);
      expect(h.item(newer.id)).toMatchObject({ state: "archived", mergedInto: older.id });
      expect(h.rows.archivedReasons.get(newer.id)).toBe("merged");
      expect(h.commentsOn(older.id)).toEqual(["> quote\nSource: memo"]);
      expect(h.commentsOn(newer.id)).toEqual([`merged into ${older.url}`]);
      expect(await runCli(["merge", newer.id, "--comment-file", tempFile()], h.deps)).toBe(2);
    });

    it("add creates an inbox item from a title and description file", async () => {
      const h = harness();
      expect(await runCli(["add", "--title", "Email Sam", "--description-file", tempFile("Source: Granola standup"), "--labels", "todo,ledger"], h.deps)).toBe(0);
      const added = [...h.rows.items.values()].find((i) => i.title === "Email Sam")!;
      expect(added).toMatchObject({ description: "Source: Granola standup", labels: ["todo", "ledger"], list: "inbox", source: "worker" });
      expect(h.out).toEqual([added.id]);
      expect(await runCli(["add", "--title", "x", "--labels", "claude"], h.deps)).toBe(1);
      expect(await runCli(["add", "--description-file", tempFile()], h.deps)).toBe(2);
    });
  });

  describe("scheduling", () => {
    const todo = (h: ReturnType<typeof harness>, title: string, labels: string[], due: Item["due"] = null, description = "> quote") =>
      seedItem(h.rows, { title, labels, due, description });
    const planFile = (estimates: { id: string; minutes: number; timeBound: boolean }[]) =>
      tempFile(JSON.stringify({ estimates, busy: [], away: [] }));
    const updates = (log: string[]) => log.filter((l) => l.startsWith("update"));

    it("to-schedule prints the horizon and the waiting items in local time", async () => {
      const h = harness();
      const a = todo(h, "Task a", ["hidock", "to-schedule"], { date: "2026-10-25", time: "14:00:00" });
      todo(h, "Task b", ["hidock"]);
      expect(await runCli(["to-schedule"], h.deps)).toBe(0);
      expect(JSON.parse(h.out[0])).toEqual({
        today: "2026-10-23",
        from: "2026-10-24T00:00:00",
        to: "2026-11-07T00:00:00",
        tasks: [{ id: a.id, title: "Task a", description: "> quote", due: { date: "2026-10-25", time: "14:00" } }],
      });
    });

    it("schedule dates an undated to-do on tomorrow and marks it suggested", async () => {
      const h = harness();
      const a = todo(h, "Task a", ["hidock", "to-schedule"]);
      expect(await runCli(["schedule", "--plan", planFile([{ id: a.id, minutes: 45, timeBound: false }])], h.deps)).toBe(0);
      expect(h.item(a.id)).toMatchObject({
        due: { date: "2026-10-24", time: null },
        description: "> quote\nestimate: 45 min",
        labels: ["hidock", "suggested"],
      });
      expect(h.out.join("\n")).toContain(`scheduled ${a.id} 2026-10-24 45m Task a`);
    });

    it("schedule gives a time-bound to-do a block after 4 pm", async () => {
      const h = harness();
      const a = todo(h, "Task a", ["hidock", "to-schedule"]);
      await runCli(["schedule", "--plan", planFile([{ id: a.id, minutes: 30, timeBound: true }])], h.deps);
      expect(h.item(a.id).due).toEqual({ date: "2026-10-24", time: "16:00" });
    });

    it("schedule keeps a stated date and only adds the estimate", async () => {
      const h = harness();
      const a = todo(h, "Task a", ["hidock", "to-schedule"], { date: "2026-10-25", time: null });
      await runCli(["schedule", "--plan", planFile([{ id: a.id, minutes: 60, timeBound: false }])], h.deps);
      expect(h.item(a.id)).toMatchObject({
        due: { date: "2026-10-25", time: null },
        description: "> quote\nestimate: 60 min",
        labels: ["hidock"],
      });
    });

    it("schedule counts a stated to-do before placing the rest", async () => {
      const h = harness();
      const s = todo(h, "Task s", ["hidock", "to-schedule"], { date: "2026-10-24", time: null });
      const a = todo(h, "Task a", ["hidock", "to-schedule"]);
      const plan = planFile([
        { id: a.id, minutes: 60, timeBound: false },
        { id: s.id, minutes: 120, timeBound: false },
      ]);
      await runCli(["schedule", "--plan", plan], h.deps);
      expect(h.item(a.id).due?.date).toBe("2026-10-25");
    });

    it("schedule counts other dated items toward a day's load", async () => {
      const h = harness();
      todo(h, "Busy", ["todo"], { date: "2026-10-24", time: null }, "estimate: 150 min");
      const a = todo(h, "Task a", ["hidock", "to-schedule"]);
      await runCli(["schedule", "--plan", planFile([{ id: a.id, minutes: 30, timeBound: false }])], h.deps);
      expect(h.item(a.id).due?.date).toBe("2026-10-25");
    });

    it("schedule skips an item that isn't waiting to be scheduled", async () => {
      const h = harness();
      const a = todo(h, "Task a", ["hidock"]);
      expect(await runCli(["schedule", "--plan", planFile([{ id: a.id, minutes: 30, timeBound: false }])], h.deps)).toBe(0);
      expect(updates(h.log)).toEqual([]);
      expect(h.out.join("\n")).toContain(`skipped ${a.id}: not waiting to be scheduled`);
    });

    it("schedule run twice changes nothing the second time", async () => {
      const h = harness();
      const a = todo(h, "Task a", ["hidock", "to-schedule"]);
      const plan = planFile([{ id: a.id, minutes: 45, timeBound: false }]);
      await runCli(["schedule", "--plan", plan], h.deps);
      h.log.length = 0;
      await runCli(["schedule", "--plan", plan], h.deps);
      expect(updates(h.log)).toEqual([]);
      expect(h.item(a.id).description.match(/estimate:/g)).toHaveLength(1);
    });

    it("schedule leaves a waiting item with no estimate alone", async () => {
      const h = harness();
      todo(h, "Task a", ["hidock", "to-schedule"]);
      await runCli(["schedule", "--plan", planFile([])], h.deps);
      expect(updates(h.log)).toEqual([]);
    });

    it("schedule keeps a timed stated to-do left out of the plan from being double-booked", async () => {
      const h = harness();
      todo(h, "Task s", ["hidock", "to-schedule"], { date: "2026-10-24", time: "16:00:00" });
      const a = todo(h, "Task a", ["hidock", "to-schedule"]);
      await runCli(["schedule", "--plan", planFile([{ id: a.id, minutes: 30, timeBound: true }])], h.deps);
      expect(h.item(a.id).due).toEqual({ date: "2026-10-24", time: "16:30" });
    });

    it("schedule never dates a memo piece sorted as an idea or thought, and stops it waiting", async () => {
      const h = harness();
      const i = todo(h, "Task i", ["hidock", "to-schedule", "idea"]);
      await runCli(["schedule", "--plan", planFile([{ id: i.id, minutes: 30, timeBound: false }])], h.deps);
      expect(h.item(i.id)).toMatchObject({ labels: ["hidock", "idea"], due: null });
    });

    it("to-schedule leaves out ideas and thoughts", async () => {
      const h = harness();
      todo(h, "Task i", ["hidock", "to-schedule", "thought"]);
      await runCli(["to-schedule"], h.deps);
      expect(JSON.parse(h.out[0]).tasks).toEqual([]);
    });

    it("schedule exits 2 on a bad plan", async () => {
      const h = harness();
      todo(h, "Task a", ["hidock", "to-schedule"]);
      expect(await runCli(["schedule", "--plan", tempFile("{}")], h.deps)).toBe(2);
      expect(h.err.join("")).toMatch(/bad plan: estimates/);
    });
  });

  it("late-migrate lists without changing anything, and --apply honours --keep", async () => {
    const h = harness();
    const late = (title: string) =>
      seedItem(h.rows, { title, labels: ["hidock", "todo"], due: { date: "2026-10-26", time: null }, description: `> quote ${title}` });
    const a = late("Book a (late)");
    const b = late("Book b (late)");
    expect(await runCli(["late-migrate"], h.deps)).toBe(0);
    expect(JSON.parse(h.out[0]).map((t: { id: string }) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(h.log).toEqual([]);
    expect(await runCli(["late-migrate", "--apply", "--keep", a.id], h.deps)).toBe(0);
    expect(h.out.slice(1).sort()).toEqual([`cleared date ${b.id} Book b`, `kept date ${a.id} Book a`].sort());
    expect(h.item(a.id)).toMatchObject({ title: "Book a", due: { date: "2026-10-26", time: null }, labels: ["hidock", "todo", "to-schedule"] });
    expect(h.item(b.id)).toMatchObject({ title: "Book b", due: null, labels: ["hidock", "todo", "to-schedule"] });
  });

  it("memos lists open hidock-memo items", async () => {
    const h = harness();
    const memo = seedItem(h.rows, { labels: ["hidock-memo"] });
    seedItem(h.rows, { labels: ["hidock"] });
    expect(await runCli(["memos"], h.deps)).toBe(0);
    expect(JSON.parse(h.out[0]).map((i: Item) => i.id)).toEqual([memo.id]);
  });
});
