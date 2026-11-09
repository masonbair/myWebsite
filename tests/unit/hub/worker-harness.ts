import { createHttpStore } from "@/lib/hub/http-store";
import { ITEM_URL_BASE } from "@/lib/hub/store";
import type { HubStore, Item } from "@/lib/hub/types";
import { handleWorkerRequest } from "@/lib/hub/worker-api";
import { createFakeStore, type FakeStore } from "./fake-store";

export const TOKEN = "test-worker-token";
export const BASE_URL = "https://hub.test";
export const NOW = new Date("2026-10-23T12:00:00Z");
export const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

let seq = 0;

/** Puts an item straight into the fake rows, so tests can set updatedAt, state and due freely. */
export function seedItem(rows: FakeStore["rows"], fields: Partial<Item> = {}): Item {
  const id = fields.id ?? `10000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const item: Item = {
    id,
    title: "Halloween costume",
    description: "",
    labels: [],
    list: "inbox",
    state: "open",
    due: null,
    mergedInto: null,
    source: "test",
    createdAt: minutesAgo(600 - seq),
    updatedAt: minutesAgo(60),
    url: `${ITEM_URL_BASE}${id}`,
    ...fields,
  };
  rows.items.set(id, item);
  return item;
}

type Harness = {
  rows: FakeStore["rows"];
  log: string[];
  fetchFn: typeof fetch;
  hub: ReturnType<typeof createHttpStore>;
};

/** The real route handler over a fake store, reached through the real HTTP client with an in-process fetch. */
export function workerHarness(
  overrides: Partial<HubStore> = {},
  server: { token?: string; ideasFiled?: Record<string, { owned: boolean; filed: string[] }> } = { token: TOKEN },
): Harness {
  const token = server.token;
  const rows = createFakeStore({ kind: "mason" }).rows;
  const log: string[] = [];
  const storeFor = (runId: string): HubStore => {
    const base = createFakeStore({ kind: "worker", runId }, rows, () => NOW);
    return {
      ...base,
      async updateItem(id, patch) {
        log.push(`update ${id}`);
        return base.updateItem(id, patch);
      },
      async addComment(id, body) {
        log.push(`comment ${id} ${body.split("\n")[0]}`);
        return base.addComment(id, body);
      },
      async setStatusLabels(id, status) {
        log.push(`status ${id} ${status}`);
        return base.setStatusLabels(id, status);
      },
      ...overrides,
    };
  };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.replace(/^\/api\/hub\/worker\//, "");
    return handleWorkerRequest(request, path.split("/").map(decodeURIComponent), {
      token,
      storeFor,
      now: () => NOW,
      ideasFiled: async () => new Map(Object.entries(server.ideasFiled ?? {})),
    });
  }) as typeof fetch;
  return { rows, log, fetchFn, hub: createHttpStore(BASE_URL, TOKEN, "run-1", fetchFn) };
}
