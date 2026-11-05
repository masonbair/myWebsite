import { ForbiddenError } from "./rules";
import type { Comment, Item } from "./types";
import type { HubWorker, WorkerView } from "./worker-api";

export class HubApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HubApiError";
    this.status = status;
  }
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** The worker API over HTTPS (plain http only to this machine), so the CLI runs anywhere with the hub URL and token. */
export function createHttpStore(baseUrl: string, token: string, runId: string, fetchFn: typeof fetch = fetch): HubWorker {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && LOCAL_HOST.test(base.hostname))) {
    throw new Error(`HUB_URL must use https (got ${base.origin})`);
  }
  const root = `${base.origin}/api/hub/worker/`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(root + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-hub-run-id": runId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;
    const message = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText;
    if (res.status === 403) throw new ForbiddenError(message);
    throw new HubApiError(res.status, `hub ${res.status} on ${method} ${path.split("/")[0]}: ${message}`);
  }

  const item = (id: string, rest = "") => `item/${encodeURIComponent(id)}${rest}`;

  return {
    async health() {
      await call("GET", "health");
    },
    view: (name: WorkerView) => call<Item[]>("GET", name),
    async getItem(id) {
      try {
        return await call<Item>("GET", item(id));
      } catch (e) {
        if (e instanceof HubApiError && e.status === 404) return null;
        throw e;
      }
    },
    listComments: (id) => call<Comment[]>("GET", item(id, "/comments")),
    addItem: (input) => call<Item>("POST", "item", input),
    updateItem: (id, patch) => call<Item>("PATCH", item(id), patch),
    async claim(id) {
      try {
        await call("POST", item(id, "/claim"), {});
        return true;
      } catch (e) {
        if (e instanceof HubApiError && e.status === 409) return false;
        throw e;
      }
    },
    report: (id, outcome, comment) => call<Item>("POST", item(id, `/${outcome}`), { comment }),
    merge: (id, into, note) => call<Item>("POST", item(id, "/merge"), { into, note }),
    addComment: (id, body) => call<Comment>("POST", item(id, "/comment"), { body }),
    async getState(key) {
      return (await call<{ value: unknown }>("GET", `state/${encodeURIComponent(key)}`)).value;
    },
    async setState(key, value) {
      await call("PUT", `state/${encodeURIComponent(key)}`, { value });
    },
  };
}
