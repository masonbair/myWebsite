import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_WORKER_COMMENT, parseItemPatch } from "./input";
import { isClaimable } from "./lifecycle";
import { ForbiddenError, assertArchiveArgs } from "./rules";
import type { Comment, HubStore, Item, ItemPatch, ItemQuery } from "./types";

export type WorkerView = "inbox" | "approved" | "laptop" | "to-schedule" | "memos" | "hidock" | "dated";
export type Outcome = "finish" | "block";
export type NewWorkerItem = { title: string; description?: string; labels?: string[] };

/** Everything the worker may do; there is deliberately no complete, reopen or delete. */
export interface HubWorker {
  health(): Promise<void>;
  view(name: WorkerView): Promise<Item[]>;
  getItem(id: string): Promise<Item | null>;
  listComments(id: string): Promise<Comment[]>;
  addItem(input: NewWorkerItem): Promise<Item>;
  updateItem(id: string, patch: ItemPatch): Promise<Item>;
  claim(id: string): Promise<boolean>;
  report(id: string, outcome: Outcome, comment: string): Promise<Item>;
  merge(id: string, into: string, note: string): Promise<Item>;
  addComment(id: string, body: string): Promise<Comment>;
  getState(key: string): Promise<unknown | null>;
  setState(key: string, value: unknown): Promise<void>;
}

export type WorkerApiDeps = {
  token: string | undefined;
  storeFor: (runId: string) => HubStore;
  now: () => Date;
};

// Room for a full-length comment even when every character takes 4 bytes in UTF-8.
export const MAX_BODY_BYTES = 256 * 1024;
const VIEW_LIMIT = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID = /^[A-Za-z0-9._-]{1,64}$/;
const STATE_KEY = /^[a-z0-9:-]{1,100}$/;
const UNSORTED = ["todo", "idea", "thought", "hidock-memo", "claude", "claude-working", "claude-done", "claude-question"];

const VIEWS: Record<WorkerView, ItemQuery> = {
  inbox: { list: "inbox", state: "open", withoutLabels: UNSORTED },
  approved: { state: "open", withLabels: ["claude"] },
  laptop: { state: "open", withLabels: ["laptop"], withoutLabels: ["claude-done"] },
  "to-schedule": { state: "open", withLabels: ["to-schedule"] },
  memos: { state: "open", withLabels: ["hidock-memo"] },
  hidock: { state: "open", withLabels: ["hidock"] },
  dated: { state: "open", hasDue: true },
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT";
type Context = {
  store: HubStore;
  params: Record<string, string>;
  body: () => Promise<Record<string, unknown>>;
  now: Date;
};
type Route = { method: Method; path: string[]; run: (ctx: Context) => Promise<Response> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

async function need(store: HubStore, id: string): Promise<Item> {
  const item = await store.getItem(id);
  if (!item) throw new ApiError(404, `no item ${id}`);
  return item;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_WORKER_COMMENT) {
    throw new ApiError(400, `${field} must be text of 1 to ${MAX_WORKER_COMMENT} characters`);
  }
  return value;
}

function parsePatch(raw: Record<string, unknown>, existingLabels: string[] = []): ItemPatch {
  try {
    return parseItemPatch(raw, existingLabels);
  } catch (e) {
    throw new ApiError(400, (e as Error).message);
  }
}

async function report(ctx: Context, outcome: Outcome): Promise<Response> {
  const { store, params } = ctx;
  const comment = requireText((await ctx.body()).comment, "comment").trim();
  const item = await need(store, params.id);
  if (item.state !== "open") throw new ApiError(409, `item ${item.id} is ${item.state}`);
  // Without a claim a run could clear an approval it never took.
  if (!item.labels.includes("claude-working")) throw new ApiError(409, `item ${item.id} is not claimed by a run`);
  const last = (await store.listComments(item.id)).at(-1);
  // A retry after a failed label change must not post the result twice.
  if (last?.body.trim() !== comment) await store.addComment(item.id, comment);
  await store.setStatusLabels(item.id, outcome === "finish" ? "claude-done" : "claude-question");
  return json(await need(store, item.id));
}

async function merge(ctx: Context): Promise<Response> {
  const { store, params } = ctx;
  const newer = await need(store, params.id);
  const body = await ctx.body();
  if (typeof body.into !== "string" || !UUID.test(body.into)) throw new ApiError(400, "into must be an item id");
  const note = requireText(body.note, "note").trim();
  assertArchiveArgs("merged", body.into, newer.id);
  if (newer.state === "archived" && newer.mergedInto === body.into) return json(newer);
  if (newer.state !== "open") throw new ApiError(409, `item ${newer.id} is ${newer.state}`);
  const older = await need(store, body.into);
  if (older.state === "archived") throw new ApiError(409, `item ${older.id} is archived`);
  // The note lands on the survivor first, so a crash before the archive leaves both items open and a retry adds nothing twice.
  const last = (await store.listComments(older.id)).at(-1);
  if (last?.body.trim() !== note) await store.addComment(older.id, note);
  return json(await store.archive(newer.id, "merged", older.id, `merged into ${older.url}`));
}

const viewRoutes: Route[] = (Object.keys(VIEWS) as WorkerView[]).map((name) => ({
  method: "GET",
  path: [name],
  async run({ store, now }) {
    const items = await store.listItems({ ...VIEWS[name], limit: VIEW_LIMIT });
    return json(name === "approved" ? items.filter((item) => isClaimable(item, now)) : items);
  },
}));

export const WORKER_ROUTES: readonly Route[] = [
  {
    method: "GET",
    path: ["health"],
    async run({ store }) {
      await store.listItems({ limit: 1 });
      return json({ ok: true });
    },
  },
  ...viewRoutes,
  { method: "GET", path: ["item", ":id"], run: async ({ store, params }) => json(await need(store, params.id)) },
  {
    method: "GET",
    path: ["item", ":id", "comments"],
    async run({ store, params }) {
      await need(store, params.id);
      return json(await store.listComments(params.id));
    },
  },
  {
    method: "POST",
    path: ["item"],
    async run({ store, body }) {
      const raw = await body();
      const patch = parsePatch({ title: raw.title, description: raw.description, labels: raw.labels });
      if (patch.title === undefined) throw new ApiError(400, "title is required");
      return json(await store.addItem({ ...patch, title: patch.title, list: "inbox", source: "worker" }), 201);
    },
  },
  {
    method: "PATCH",
    path: ["item", ":id"],
    async run({ store, params, body }) {
      const item = await need(store, params.id);
      if (item.state !== "open") throw new ApiError(409, `item ${item.id} is ${item.state}`);
      return json(await store.updateItem(item.id, parsePatch(await body(), item.labels)));
    },
  },
  {
    method: "POST",
    path: ["item", ":id", "claim"],
    async run({ store, params }) {
      await need(store, params.id);
      if (await store.claim(params.id)) return json({ claimed: true });
      return json({ error: `not claimable: ${params.id}` }, 409);
    },
  },
  { method: "POST", path: ["item", ":id", "finish"], run: (ctx) => report(ctx, "finish") },
  { method: "POST", path: ["item", ":id", "block"], run: (ctx) => report(ctx, "block") },
  { method: "POST", path: ["item", ":id", "merge"], run: merge },
  {
    method: "POST",
    path: ["item", ":id", "comment"],
    async run({ store, params, body }) {
      const text = requireText((await body()).body, "body");
      await need(store, params.id);
      return json(await store.addComment(params.id, text), 201);
    },
  },
  {
    method: "GET",
    path: ["state", ":key"],
    run: async ({ store, params }) => json({ value: await store.getHubState(params.key) }),
  },
  {
    method: "PUT",
    path: ["state", ":key"],
    async run({ store, params, body }) {
      const raw = await body();
      if (!("value" in raw) || raw.value === undefined) throw new ApiError(400, "value is required");
      await store.setHubState(params.key, raw.value);
      return json({ ok: true });
    },
  },
];

function tokenMatches(header: string | null, expected: string): boolean {
  const given = header?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected)) && given.length > 0;
}

function match(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const route of WORKER_ROUTES) {
    if (route.method !== method || route.path.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = route.path.every((part, i) => {
      if (part.startsWith(":")) params[part.slice(1)] = segments[i];
      return part.startsWith(":") || part === segments[i];
    });
    if (fits) return { route, params };
  }
  return null;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new ApiError(413, "body too large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch {
    throw new ApiError(400, "body must be JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ApiError(400, "body must be an object");
  return parsed as Record<string, unknown>;
}

/** Serves one worker API call; the caller's token is checked here even though the proxy pre-checks the header. */
export async function handleWorkerRequest(request: Request, segments: string[], deps: WorkerApiDeps): Promise<Response> {
  if (!deps.token) return json({ error: "worker api is not configured" }, 503);
  if (!tokenMatches(request.headers.get("authorization"), deps.token)) return json({ error: "unauthorized" }, 401);
  const runId = request.headers.get("x-hub-run-id") ?? "";
  if (!RUN_ID.test(runId)) return json({ error: "X-Hub-Run-Id must be 1 to 64 of A-Z a-z 0-9 . _ -" }, 400);
  const found = match(request.method, segments);
  if (!found) return json({ error: "not found" }, 404);
  if (found.params.id !== undefined && !UUID.test(found.params.id)) return json({ error: "bad item id" }, 400);
  if (found.params.key !== undefined && !STATE_KEY.test(found.params.key)) return json({ error: "bad state key" }, 400);
  try {
    return await found.route.run({
      store: deps.storeFor(runId),
      params: found.params,
      body: () => readBody(request),
      now: deps.now(),
    });
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
    console.error("hub worker api", request.method, segments.join("/"), e);
    return json({ error: "server error" }, 500);
  }
}
