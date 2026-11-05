import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { HUB_E2E_MEMO_TOKEN, HUB_E2E_WORKER_TOKEN, HUB_PORT } from "./hub-ports";
import { ownerDbClient, serviceClient, supabase } from "./hub-session";

// One worker run against the local dev server and local Supabase: bin/hub with the canned decisions hub/worker/PROMPT.md asks for.

const HUB_URL = `http://localhost:${HUB_PORT}`;
const scratch = mkdtempSync(join(tmpdir(), "hub-dry-run-"));

type Row = {
  id: string;
  title: string;
  description: string;
  labels: string[];
  list: string;
  state: string;
  archived_reason: string | null;
  merged_into: string | null;
  updated_at: string;
};
const COLUMNS = "id, title, description, labels, list, state, archived_reason, merged_into, updated_at";

let stub: Server;
let stubUrl = "";
const pings: { topic: string; title: string; message: string; click?: string }[] = [];
const commandsRun = new Set<string>();

test.beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      pings.push(JSON.parse(body));
      res.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((done) => stub.listen(0, "127.0.0.1", done));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/`;
});

test.afterAll(() => new Promise<void>((done) => stub.close(() => done())));

// Async on purpose: spawnSync would block this process, so the ntfy stub it hosts could never answer bin/hub.
function hub(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  commandsRun.add(args[0]);
  const env = {
    ...process.env,
    HUB_URL,
    HUB_WORKER_TOKEN: HUB_E2E_WORKER_TOKEN,
    NTFY_TOPIC: "hub-dry-run",
    NTFY_STUB_URL: stubUrl,
    NODE_OPTIONS: `--import=${pathToFileURL(resolve("tests/e2e/ntfy-stub.mjs")).href}`,
    HUB_PROJECTS_FILE: resolve("hub/worker/projects.json"),
    HUB_TIME_ZONE: "America/Denver",
  };
  return new Promise((done, fail) => {
    const child = spawn("bin/hub", args, { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (status) => {
      console.log(`$ hub ${args.join(" ")} -> exit ${status}${stderr ? `\n${stderr.trim()}` : ""}`);
      done({ status, stdout, stderr });
    });
  });
}

async function hubJson<T>(args: string[]): Promise<T> {
  const run = await hub(args);
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as T;
}

function tempFile(name: string, content: string): string {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
}

async function row(id: string): Promise<Row> {
  const { data, error } = await serviceClient().from("items").select(COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as Row;
}

async function commentsOn(id: string): Promise<string[]> {
  const { data, error } = await serviceClient().from("comments").select("body").eq("item_id", id).order("created_at");
  if (error) throw error;
  return (data as { body: string }[]).map((c) => c.body);
}

async function itemCount(): Promise<number> {
  const { count, error } = await serviceClient().from("items").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

test.describe("worker dry run", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test("a scheduled run sorts, merges and splits, and a fired run finishes the approved item", async () => {
    const tag = randomUUID().slice(0, 8);
    const owner = await ownerDbClient();
    const seed = async (title: string, labels: string[] = []) => {
      const { data, error } = await owner.from("items").insert({ title, labels, source: "e2e" }).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    };
    const countBefore = await itemCount();

    const todoId = await seed(`Renew passport ${tag}`);
    const ideaId = await seed(`App that plans costume parties ${tag}`);
    const unclearId = await seed(`blue thing ${tag}`);
    const olderId = await seed(`Book flights to Lisbon ${tag}`);
    const newerId = await seed(`book flights to lisbon ${tag}`);
    const approvedId = await seed(`Compare three standing desks ${tag}`, ["claude"]);
    const memoFile = `dry-run-${tag}.hda`;
    const upload = await fetch(`${HUB_URL}/api/memo`, {
      method: "POST",
      headers: { authorization: `Bearer ${HUB_E2E_MEMO_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        file: memoFile,
        recorded: "2026-10-22T18:35:04",
        transcript: `Call the dentist tomorrow. Idea: a costume app. For my website, add a recipes page ${tag}.`,
        device: "phone",
      }),
    });
    expect(upload.status).toBe(201);
    const memoId = ((await upload.json()) as { id: string }).id;
    const unclearBefore = await row(unclearId);

    expect((await hub(["setup"])).status).toBe(0);

    // Step 5: split the memo.
    const memos = await hubJson<{ id: string; file: string; recorded: string; transcript: string }[]>(["memos"]);
    const memo = memos.find((m) => m.id === memoId);
    expect(memo).toMatchObject({ file: memoFile, recorded: "2026-10-22T18:35:04" });
    const pieces = {
      todos: [{ text: "Call the dentist", source: "Call the dentist tomorrow.", date: "2026-10-23", time: null, project: null }],
      notes: [{ text: `Add a recipes page ${tag}`, source: `For my website, add a recipes page ${tag}.`, project: "mywebsite" }],
      ideas: [{ text: "A costume app", source: "Idea: a costume app." }],
    };
    const split = await hub(["memo-split", memoId, "--pieces", tempFile("pieces.json", JSON.stringify(pieces))]);
    expect(split.status, split.stderr).toBe(0);
    expect(split.stdout.trim()).toBe("filed 3 pieces");

    // Step 6: sort the inbox. The unclear note gets no command at all.
    type InboxItem = { id: string; title: string; labels: string[]; createdAt: string; url: string; description: string };
    const inbox = await hubJson<InboxItem[]>(["inbox"]);
    const inboxIds = inbox.map((i) => i.id);
    for (const id of [todoId, ideaId, unclearId, olderId, newerId]) expect(inboxIds).toContain(id);
    expect(inboxIds).not.toContain(approvedId);
    expect(inboxIds).not.toContain(memoId);
    const piecesInInbox = inbox.filter((i) => i.description.includes(`hinote-ref: ${memoFile}#`));
    expect(piecesInInbox.map((i) => i.title).sort()).toEqual(["A costume app", `Add a recipes page ${tag}`, "Call the dentist"]);
    const piece = (title: string) => piecesInInbox.find((i) => i.title === title)!;

    expect((await hub(["sort", todoId, "--kind", "todo"])).status).toBe(0);
    expect((await hub(["sort", ideaId, "--kind", "idea"])).status).toBe(0);
    expect((await hub(["sort", piece("Call the dentist").id, "--kind", "todo"])).status).toBe(0);
    expect((await hub(["sort", piece("A costume app").id, "--kind", "idea"])).status).toBe(0);
    expect((await hub(["sort", piece(`Add a recipes page ${tag}`).id, "--kind", "thought", "--project", "mywebsite"])).status).toBe(0);

    const older = inbox.find((i) => i.id === olderId)!;
    const newer = inbox.find((i) => i.id === newerId)!;
    expect(Date.parse(older.createdAt)).toBeLessThanOrEqual(Date.parse(newer.createdAt));
    const mergeNote = `Same task captured again: "${newer.title}" (${newer.url})`;
    const merged = await hub(["merge", newerId, "--into", olderId, "--comment-file", tempFile("merge.txt", mergeNote)]);
    expect(merged.status, merged.stderr).toBe(0);
    expect((await hub(["sort", olderId, "--kind", "todo"])).status).toBe(0);

    // Step 8, fired run: the payload names the approved item.
    expect((await hub(["claim", approvedId])).status).toBe(0);
    expect((await hubJson<{ id: string; title: string }>(["item", approvedId])).title).toBe(`Compare three standing desks ${tag}`);
    expect(await hubJson<unknown[]>(["comments", approvedId])).toEqual([]);
    const result = "Three desks compared; the Uplift V2 fits best\n\nDetails.\n\nhttps://example.com/desks";
    const commentFile = tempFile("result.txt", result);
    expect((await hub(["finish", approvedId, "--comment-file", commentFile])).status).toBe(0);
    // A retried finish after success exits 3 and posts nothing twice.
    expect((await hub(["finish", approvedId, "--comment-file", commentFile])).status).toBe(3);

    expect(await row(unclearId)).toEqual(unclearBefore);
    expect(inboxIds).toContain(unclearBefore.id);
    expect(await commentsOn(unclearId)).toEqual([]);

    expect(await row(olderId)).toMatchObject({ state: "open", list: "todo", labels: ["todo"] });
    expect(await commentsOn(olderId)).toEqual([mergeNote]);
    const newerAfter = await row(newerId);
    expect(newerAfter).toMatchObject({ state: "archived", archived_reason: "merged", merged_into: olderId });
    expect((await commentsOn(newerId)).at(-1)).toMatch(new RegExp(`^merged into \\S+/hub/item/${olderId}$`));

    expect(await row(memoId)).toMatchObject({ state: "archived", archived_reason: "memo-split", merged_into: null });
    expect((await commentsOn(memoId)).at(-1)).toMatch(/^split into 3 items:\n/);
    expect(await row(piece("Call the dentist").id)).toMatchObject({
      state: "open",
      list: "todo",
      labels: ["hidock", "to-schedule", "todo"],
    });
    expect(await row(piece("A costume app").id)).toMatchObject({ list: "ideas", labels: ["hidock", "idea"] });
    expect(await row(piece(`Add a recipes page ${tag}`).id)).toMatchObject({
      list: "ideas",
      labels: ["hidock", "mywebsite", "thought"],
    });
    expect(await row(todoId)).toMatchObject({ list: "todo", labels: ["todo"] });
    expect(await row(ideaId)).toMatchObject({ list: "ideas", labels: ["idea"] });

    expect(await row(approvedId)).toMatchObject({ state: "open", labels: ["claude-done"] });
    expect(await commentsOn(approvedId)).toEqual([result]);
    expect(pings).toEqual([
      {
        topic: "hub-dry-run",
        title: `Done: Compare three standing desks ${tag}`,
        message: "Three desks compared; the Uplift V2 fits best",
        click: `https://masonbair.com/hub/item/${approvedId}`,
      },
    ]);

    const touched = [todoId, ideaId, unclearId, olderId, newerId, approvedId, memoId, ...piecesInInbox.map((i) => i.id)];
    const { data: states, error } = await serviceClient().from("items").select("id, state").in("id", touched);
    if (error) throw error;
    expect(states).toHaveLength(touched.length);
    expect((states as { state: string }[]).filter((s) => s.state === "done")).toEqual([]);
    expect(await itemCount()).toBeGreaterThanOrEqual(countBefore + touched.length);

    const prompt = readFileSync("hub/worker/PROMPT.md", "utf8");
    for (const command of commandsRun) expect(prompt, `PROMPT.md never says \`hub ${command}\``).toContain(`hub ${command}`);
  });
});
