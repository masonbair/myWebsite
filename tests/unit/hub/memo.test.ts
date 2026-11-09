import { describe, expect, it, vi } from "vitest";
import { handleMemo, memoItem } from "@/lib/hub/memo";
import type { HubStore } from "@/lib/hub/types";
import { createFakeStore, type FakeStore } from "./fake-store";

const TOKEN = "up-tok";
const FILE = "2026Oct22-183504-Rec22.hda";
const BODY = { file: FILE, recorded: "2026-10-22T18:35:04", transcript: "Call the dentist tomorrow.", device: "phone" };

const relay = () => createFakeStore({ kind: "worker", runId: "memo-relay" });

const request = (body: unknown, token: string | null = TOKEN) =>
  new Request("https://masonbair.com/api/memo", {
    method: "POST",
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

type SendOpts = {
  store?: HubStore;
  token?: string | null;
  serverToken?: string;
  memoDetection?: boolean;
  queueIdeas?: (itemId: string) => Promise<void>;
};

async function send(body: unknown, opts: SendOpts = {}) {
  const res = await handleMemo(request(body, opts.token === undefined ? TOKEN : opts.token), {
    token: "serverToken" in opts ? opts.serverToken : TOKEN,
    store: opts.store ?? relay(),
    memoDetection: opts.memoDetection,
    queueIdeas: opts.queueIdeas,
  });
  return { status: res.status, json: await res.json() };
}

const itemsOf = (store: FakeStore) => [...store.rows.items.values()];
const commentsOf = (store: FakeStore, id: string) => store.rows.comments.filter((c) => c.itemId === id);

describe("handleMemo", () => {
  it("creates one hidock-memo inbox item with the transcript in worker comments", async () => {
    const store = relay();
    const res = await send(BODY, { store });
    const [item] = itemsOf(store);
    expect(res).toEqual({ status: 201, json: { status: "created", id: item.id, taskId: item.id } });
    expect(item).toMatchObject({
      title: "HiDock memo 2026Oct22-183504-Rec22",
      description: `Source: HiDock ${FILE}, recorded 2026-10-22T18:35:04\nhidock-file: ${FILE}`,
      labels: ["hidock-memo"],
      list: "inbox",
      state: "open",
      source: "memo:phone",
    });
    expect(commentsOf(store, item.id)).toEqual([
      expect.objectContaining({ body: "transcript (part 1 of 1):\nCall the dentist tomorrow.", author: "worker" }),
    ]);
  });

  it("gives one item when the phone and then the Mac send the same file", async () => {
    const store = relay();
    const first = await send(BODY, { store });
    const second = await send({ ...BODY, device: "mac" }, { store });
    expect(second).toEqual({
      status: 200,
      json: { status: "duplicate", duplicate: true, id: first.json.id, taskId: first.json.id },
    });
    expect(itemsOf(store)).toHaveLength(1);
    expect(store.rows.comments).toHaveLength(1);
  });

  it("treats a seeded file as a duplicate with no item id", async () => {
    const store = relay();
    await store.seedMemoFiles([FILE]);
    expect(await send(BODY, { store })).toEqual({
      status: 200,
      json: { status: "duplicate", duplicate: true, id: null, taskId: null },
    });
    expect(itemsOf(store)).toHaveLength(0);
  });

  it.each([
    ["wrong token", "nope"],
    ["missing header", null],
  ])("rejects a %s with 401", async (_name, token) => {
    const store = relay();
    expect((await send(BODY, { token, store })).status).toBe(401);
    expect(itemsOf(store)).toHaveLength(0);
  });

  it.each([undefined, ""])("answers 503 when the upload token is not configured (%j)", async (serverToken) => {
    const r = await send(BODY, { serverToken, token: "" });
    expect(r).toEqual({ status: 503, json: { error: "misconfigured", message: expect.any(String) } });
  });

  it.each([
    ["unknown device", { ...BODY, device: "tablet" }],
    ["recorded without seconds", { ...BODY, recorded: "2026-10-22 18:35" }],
    ["recorded on a day that does not exist", { ...BODY, recorded: "2026-02-30T12:00:00" }],
    ["recorded at an hour that does not exist", { ...BODY, recorded: "2026-10-22T25:00:00" }],
    ["file with a path", { ...BODY, file: "../x" }],
    ["empty file name", { ...BODY, file: "" }],
    ["blank transcript", { ...BODY, transcript: "  \n" }],
    ["missing field", { file: FILE, recorded: BODY.recorded, device: "mac" }],
    ["not JSON", "{oops"],
    ["a JSON array", "[]"],
  ])("rejects %s with 400", async (_name, body) => {
    const store = relay();
    const r = await send(body, { store });
    expect(r).toEqual({ status: 400, json: { error: "bad_request", message: expect.any(String) } });
    expect(itemsOf(store)).toHaveLength(0);
  });

  it("rejects a body over 1 MB with 413", async () => {
    const r = await send({ ...BODY, transcript: "a".repeat(1_000_001) });
    expect(r).toEqual({ status: 413, json: { error: "too_large", message: expect.any(String) } });
  });

  it("splits a long transcript into numbered 15,000-character comments", async () => {
    const store = relay();
    const { json } = await send({ ...BODY, transcript: "b".repeat(20_000) }, { store });
    expect(commentsOf(store, json.id).map((c) => c.body)).toEqual([
      `transcript (part 1 of 2):\n${"b".repeat(15_000)}`,
      `transcript (part 2 of 2):\n${"b".repeat(5_000)}`,
    ]);
  });

  it("queues no ideas detection while IDEAS_MEMO_DETECTION is off", async () => {
    const queued: string[] = [];
    const res = await send(BODY, { memoDetection: false, queueIdeas: async (id) => void queued.push(id) });
    expect(res.status).toBe(201);
    expect(queued).toEqual([]);
  });

  it("with the switch on, queues the new memo once and not its duplicate", async () => {
    const store = relay();
    const queued: string[] = [];
    const queueIdeas = async (id: string) => void queued.push(id);
    const first = await send(BODY, { store, memoDetection: true, queueIdeas });
    await send({ ...BODY, device: "mac" }, { store, memoDetection: true, queueIdeas });
    expect(queued).toEqual([first.json.id]);
  });

  it("still answers 201 when queueing detection fails, logging only the id", async () => {
    const store = relay();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send(BODY, {
      store,
      memoDetection: true,
      queueIdeas: async () => {
        throw new Error("Call the dentist tomorrow.");
      },
    });
    expect(res.status).toBe(201);
    expect(itemsOf(store)).toHaveLength(1);
    expect(log.mock.calls.flat().join(" ")).toBe(`memo ${res.json.id}: ideas detection not queued`);
    log.mockRestore();
  });

  it("answers 502 and files nothing when the database fails", async () => {
    const store: HubStore = {
      ...relay(),
      acceptMemo: async () => {
        throw new Error("db down");
      },
    };
    const r = await send(BODY, { store });
    expect(r).toEqual({ status: 502, json: { error: "upstream", message: expect.any(String) } });
  });
});

describe("memoItem", () => {
  it("splits a 40,000-character transcript into three parts that join back exactly", () => {
    const transcript = Array.from({ length: 40_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    const m = memoItem({ file: FILE, recorded: "2026-10-22T18:35:04", transcript });
    expect(m.title).toBe("HiDock memo 2026Oct22-183504-Rec22");
    expect(m.transcriptParts.map((c) => c.split("\n")[0])).toEqual([
      "transcript (part 1 of 3):",
      "transcript (part 2 of 3):",
      "transcript (part 3 of 3):",
    ]);
    expect(m.transcriptParts.map((c) => c.slice(c.indexOf("\n") + 1)).join("")).toBe(transcript);
  });

  it("never cuts an emoji in half at a part boundary", () => {
    const transcript = `${"a".repeat(14_999)}😀${"b".repeat(10)}`;
    const parts = memoItem({ file: FILE, recorded: "r", transcript }).transcriptParts.map((c) => c.slice(c.indexOf("\n") + 1));
    expect(parts).toEqual(["a".repeat(14_999), `😀${"b".repeat(10)}`]);
    expect(parts.join("")).toBe(transcript);
  });

  it("trims the transcript", () => {
    expect(memoItem({ file: FILE, recorded: "r", transcript: "  hi \n" }).transcriptParts).toEqual(["transcript (part 1 of 1):\nhi"]);
  });
});
