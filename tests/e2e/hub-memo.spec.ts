import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { HUB_E2E_MEMO_TOKEN, HUB_E2E_WORKER_TOKEN, HUB_PORT } from "./hub-ports";
import { serviceClient } from "./hub-session";

// Runs only in the "hub" project: the real /api/memo route and local Supabase, then bin/hub splits the memo.

const HUB_URL = `http://localhost:${HUB_PORT}`;

function upload(file: string, device: "phone" | "mac", token = HUB_E2E_MEMO_TOKEN) {
  return fetch(`${HUB_URL}/api/memo`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ file, recorded: "2026-10-22T18:35:04", transcript: "Call the dentist tomorrow. Idea: a costume app.", device }),
  });
}

const newFile = () => `e2e-${randomUUID().slice(0, 8)}.hda`;

async function memoItems(file: string) {
  const { data, error } = await serviceClient()
    .from("items")
    .select("id, state, archived_reason, labels")
    .eq("description", `Source: HiDock ${file}, recorded 2026-10-22T18:35:04\nhidock-file: ${file}`);
  if (error) throw error;
  return data as { id: string; state: string; archived_reason: string | null; labels: string[] }[];
}

function hub(args: string[]) {
  const env = { ...process.env, HUB_URL, HUB_WORKER_TOKEN: HUB_E2E_WORKER_TOKEN, NTFY_TOPIC: "unused-in-e2e", HUB_PROJECTS_FILE: "/nonexistent" };
  return spawnSync("bin/hub", args, { env, encoding: "utf8" });
}

test("the same file from the phone and then the Mac gives one item", async () => {
  const file = newFile();
  const first = await upload(file, "phone");
  expect(first.status).toBe(201);
  const { id, ...rest } = (await first.json()) as { id: string };
  expect(rest).toEqual({ status: "created", taskId: id });
  const second = await upload(file, "mac");
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual({ status: "duplicate", duplicate: true, id, taskId: id });
  expect(await memoItems(file)).toEqual([{ id, state: "open", archived_reason: null, labels: ["hidock-memo"] }]);
  // IDEAS_MEMO_DETECTION is unset here, so the relay queues nothing for the Ideas Lab.
  const { data: sources, error } = await serviceClient().from("idea_sources").select("source_item_id").eq("source_item_id", id);
  if (error) throw error;
  expect(sources).toEqual([]);
});

test("two uploads of one file at the same moment still give one item", async () => {
  const file = newFile();
  const statuses = (await Promise.all([upload(file, "phone"), upload(file, "mac")])).map((r) => r.status).sort();
  expect(statuses).toEqual([200, 201]);
  expect(await memoItems(file)).toHaveLength(1);
});

test("refuses a wrong token and stores nothing", async () => {
  const file = newFile();
  expect((await upload(file, "phone", "wrong")).status).toBe(401);
  expect(await memoItems(file)).toEqual([]);
});

test("bin/hub memo-split files the pieces and leaves the memo archived, never done", async () => {
  const file = newFile();
  const { id } = (await (await upload(file, "phone")).json()) as { id: string };
  const memos = JSON.parse(hub(["memos"]).stdout) as { id: string; file: string; transcript: string }[];
  expect(memos).toContainEqual({ id, file, recorded: "2026-10-22T18:35:04", transcript: "Call the dentist tomorrow. Idea: a costume app.", ideasOwnedByIdeasLab: false, ideasFiled: [] });

  const pieces = join(mkdtempSync(join(tmpdir(), "hub-memo-")), "pieces.json");
  writeFileSync(pieces, JSON.stringify({
    todos: [{ text: "Call the dentist", source: "Call the dentist tomorrow.", date: "2026-10-23", time: null, project: null }],
    notes: [],
    ideas: [{ text: "Costume app", source: "Idea: a costume app." }],
  }));
  for (let run = 0; run < 2; run++) {
    const split = hub(["memo-split", id, "--pieces", pieces]);
    expect(split.stderr).toBe("");
    expect(split.stdout.trim()).toBe("filed 2 pieces");
  }

  expect(await memoItems(file)).toEqual([{ id, state: "archived", archived_reason: "memo-split", labels: ["hidock-memo"] }]);
  const { data, error } = await serviceClient().from("items").select("title, state, labels, list").like("client_key", `hidock:${file}#%`).order("title");
  if (error) throw error;
  expect(data).toEqual([
    { title: "Call the dentist", state: "open", labels: ["hidock", "to-schedule"], list: "inbox" },
    { title: "Costume app", state: "open", labels: ["hidock"], list: "inbox" },
  ]);
});

test("bin/hub memo-split files no ideas while the Ideas Lab owns the memo's ideas", async () => {
  const file = newFile();
  const { id } = (await (await upload(file, "phone")).json()) as { id: string };
  const { data: idea, error: ideaError } = await serviceClient()
    .from("items")
    .insert({ title: "Costume app", list: "ideas", labels: ["idea"], source: "ideas-lab", client_key: `idea:${id}#0` })
    .select("id")
    .single();
  if (ideaError) throw ideaError;
  const { error } = await serviceClient()
    .from("idea_sources")
    .insert({ source_item_id: id, kind: "memo", status: "done", idea_item_ids: [idea.id], quotes: ["Idea: a costume app."] });
  if (error) throw error;

  const memos = JSON.parse(hub(["memos"]).stdout) as { id: string; ideasOwnedByIdeasLab: boolean; ideasFiled: string[] }[];
  expect(memos.find((m) => m.id === id)).toMatchObject({ ideasOwnedByIdeasLab: true, ideasFiled: [idea.id] });
  const pieces = join(mkdtempSync(join(tmpdir(), "hub-memo-")), "pieces.json");
  writeFileSync(pieces, JSON.stringify({
    todos: [{ text: "Call the dentist", source: "Call the dentist tomorrow.", date: "2026-10-23", time: null, project: null }],
    notes: [],
    ideas: [{ text: "Costume app", source: "Idea: a costume app." }],
  }));
  const split = hub(["memo-split", id, "--pieces", pieces]);
  expect(split.stderr).toBe("");
  expect(split.stdout.trim()).toBe("filed 1 pieces");
  const { data, error: piecesError } = await serviceClient().from("items").select("title").like("client_key", `hidock:${file}#%`);
  if (piecesError) throw piecesError;
  expect(data).toEqual([{ title: "Call the dentist" }]);
});
