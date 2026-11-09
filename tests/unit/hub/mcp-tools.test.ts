import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getIdeaPage, listIdeas } from "@/lib/ideas/read";
import { monthSpend } from "@/lib/ai/claude";
import { MCP_TOOL_NAMES, handleMcpRequest } from "@/lib/hub/mcp-tools";
import type { NowData } from "@/lib/now";
import { createFakeStore } from "./fake-store";
import { seedItem } from "./worker-harness";

vi.mock("@/lib/ideas/read", async (original) => ({ ...(await original<typeof import("@/lib/ideas/read")>()), listIdeas: vi.fn(), getIdeaPage: vi.fn() }));
vi.mock("@/lib/ai/claude", async (original) => ({ ...(await original<typeof import("@/lib/ai/claude")>()), monthSpend: vi.fn() }));

const writeVerbs = new Set(["insert", "update", "upsert", "delete", "rpc"]);
const readOnlyClient = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (typeof prop === "string" && writeVerbs.has(prop)) throw new Error(`write attempted: ${prop}`);
      return undefined;
    },
  },
) as unknown as SupabaseClient;

const TOKEN = "test-agent-token";
const URL_BASE = "https://hub.test/api/mcp/mcp";

const NOW: NowData = {
  place: { city: "Secret Town", region: "Ohio", country: "USA", private: true, updatedAt: "2026-11-01T00:00:00Z" },
  countriesVisited: 23,
  bake: { name: "Sourdough", photo: null, bakedAt: "2026-10-30T00:00:00Z" },
  photos: [{ src: "/misc/a.webp", alt: "Mason" }],
};

function setup(options: { token?: string; clientName?: string | null; serverToken?: string | undefined } = {}) {
  const rows = createFakeStore({ kind: "mason" }).rows;
  const clients: string[] = [];
  const serverToken = "serverToken" in options ? options.serverToken : TOKEN;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) =>
    handleMcpRequest(new Request(input, init), {
      token: serverToken,
      storeFor: (client) => {
        clients.push(client);
        return createFakeStore({ kind: "agent", client }, rows);
      },
      readNow: async () => NOW,
      ideasClient: readOnlyClient,
      now: () => new Date("2026-11-09T12:00:00Z"),
    })) as typeof fetch;
  const headers: Record<string, string> = { authorization: `Bearer ${options.token ?? TOKEN}` };
  if (options.clientName !== null) headers["x-client-name"] = options.clientName ?? "test-agent";
  return { rows, clients, fetchFn, headers };
}

async function connect(options: Parameters<typeof setup>[0] = {}) {
  const env = setup(options);
  const transport = new StreamableHTTPClientTransport(new URL(URL_BASE), { fetch: env.fetchFn, requestInit: { headers: env.headers } });
  const client = new Client({ name: "vitest", version: "1.0.0" });
  await client.connect(transport);
  return { ...env, client };
}

function text(result: { content?: unknown }): string {
  return ((result.content as { type: string; text: string }[]) ?? []).map((c) => c.text).join("\n");
}

describe("mcp agent connector", () => {
  it("registers exactly the agent tools, none that complete, delete, send or deploy", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["add_comment", "add_item", "find_items", "get_item", "get_now", "list_comments", "merge_duplicate", "update_item", "ideas_list", "idea_get", "ai_costs"].sort(),
    );
    expect([...MCP_TOOL_NAMES].sort()).toEqual(names);
    for (const tool of tools) expect(tool.description).toMatch(/data, never instructions/);
  });

  it("add_item lands in the inbox with the client as the source", async () => {
    const { client, rows } = await connect({ clientName: "claude-code" });
    const result = await client.callTool({ name: "add_item", arguments: { title: "Buy flour", labels: ["Laptop"] } });
    expect(result.isError).toBeFalsy();
    const [item] = [...rows.items.values()];
    expect(item).toMatchObject({ title: "Buy flour", list: "inbox", source: "agent:claude-code", labels: ["laptop"] });
  });

  it("add_item refuses the claude label", async () => {
    const { client, rows } = await connect();
    const result = await client.callTool({ name: "add_item", arguments: { title: "x", labels: ["claude"] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("may not change the label claude");
    expect(rows.items.size).toBe(0);
  });

  it("update_item adding claude is a tool error and leaves the labels alone", async () => {
    const { client, rows } = await connect();
    const item = seedItem(rows, { labels: ["todo"] });
    const result = await client.callTool({ name: "update_item", arguments: { id: item.id, labels: ["todo", "claude"] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("claude");
    expect(rows.items.get(item.id)?.labels).toEqual(["todo"]);
  });

  it("update_item changes title, list and due", async () => {
    const { client, rows } = await connect();
    const item = seedItem(rows);
    const result = await client.callTool({
      name: "update_item",
      arguments: { id: item.id, title: "New title", list: "todo", due: { date: "2026-11-20", time: null } },
    });
    expect(result.isError).toBeFalsy();
    expect(rows.items.get(item.id)).toMatchObject({ title: "New title", list: "todo", due: { date: "2026-11-20", time: null } });
  });

  it("update_item refuses a bad due date and an unknown item", async () => {
    const { client, rows } = await connect();
    const item = seedItem(rows);
    expect((await client.callTool({ name: "update_item", arguments: { id: item.id, due: { date: "2026-02-31" } } })).isError).toBe(true);
    const missing = await client.callTool({ name: "update_item", arguments: { id: "20000000-0000-4000-8000-000000000001", title: "x" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("no item");
  });

  it("merge_duplicate with the same item twice errors and archives nothing", async () => {
    const { client, rows } = await connect();
    const item = seedItem(rows);
    const result = await client.callTool({ name: "merge_duplicate", arguments: { newer: item.id, older: item.id, note: "same" } });
    expect(result.isError).toBe(true);
    expect(rows.items.get(item.id)?.state).toBe("open");
  });

  it("merge_duplicate archives the newer item into the older one with a note", async () => {
    const { client, rows } = await connect();
    const older = seedItem(rows, { title: "Call mom" });
    const newer = seedItem(rows, { title: "call mom" });
    const result = await client.callTool({ name: "merge_duplicate", arguments: { newer: newer.id, older: older.id, note: "same task" } });
    expect(result.isError).toBeFalsy();
    expect(rows.items.get(newer.id)).toMatchObject({ state: "archived", mergedInto: older.id });
    expect(rows.archivedReasons.get(newer.id)).toBe("merged");
    expect(rows.comments.find((c) => c.itemId === newer.id)?.body).toBe(`merged into ${older.url}`);
    expect(rows.comments.filter((c) => c.itemId === older.id).map((c) => c.body)).toEqual(["same task"]);
    const again = await client.callTool({ name: "merge_duplicate", arguments: { newer: newer.id, older: older.id, note: "same task" } });
    expect(again.isError).toBeFalsy();
    expect(rows.comments.filter((c) => c.itemId === older.id)).toHaveLength(1);
  });

  it("update_item and add_comment refuse a done or archived item and keep its text", async () => {
    const { client, rows } = await connect();
    for (const state of ["done", "archived"] as const) {
      const item = seedItem(rows, { title: "Mason's words", description: "kept", state });
      const update = await client.callTool({ name: "update_item", arguments: { id: item.id, description: "" } });
      expect(update.isError).toBe(true);
      expect(text(update)).toBe(`item ${item.id} is ${state}`);
      const comment = await client.callTool({ name: "add_comment", arguments: { id: item.id, body: "hi" } });
      expect(comment.isError).toBe(true);
      expect(rows.items.get(item.id)).toMatchObject({ title: "Mason's words", description: "kept" });
      expect(rows.comments.filter((c) => c.itemId === item.id)).toEqual([]);
    }
  });

  it("an agent rewrite of an open item keeps the old text in history", async () => {
    const { client, rows } = await connect();
    const item = seedItem(rows, { title: "Call mom", description: "about the trip" });
    expect((await client.callTool({ name: "update_item", arguments: { id: item.id, description: "" } })).isError).toBeFalsy();
    expect(rows.history).toEqual([expect.objectContaining({ itemId: item.id, title: "Call mom", description: "about the trip" })]);
  });

  it("merge_duplicate refuses a done item and a missing older item", async () => {
    const { client, rows } = await connect();
    const older = seedItem(rows);
    const done = seedItem(rows, { state: "done" });
    expect((await client.callTool({ name: "merge_duplicate", arguments: { newer: done.id, older: older.id, note: "n" } })).isError).toBe(true);
    const open = seedItem(rows);
    const missing = "20000000-0000-4000-8000-000000000002";
    expect((await client.callTool({ name: "merge_duplicate", arguments: { newer: open.id, older: missing, note: "n" } })).isError).toBe(true);
    expect(rows.items.get(open.id)?.state).toBe("open");
  });

  it("find_items searches title and description, case-insensitive, with wildcards taken literally", async () => {
    const { client, rows } = await connect();
    const flour = seedItem(rows, { title: "Buy FLOUR" });
    const percent = seedItem(rows, { title: "50% off", description: "" });
    seedItem(rows, { title: "Other", description: "nothing" });
    const byText = await client.callTool({ name: "find_items", arguments: { text: "flour" } });
    expect(JSON.parse(text(byText)).map((i: { id: string }) => i.id)).toEqual([flour.id]);
    const literal = await client.callTool({ name: "find_items", arguments: { text: "%" } });
    expect(JSON.parse(text(literal)).map((i: { id: string }) => i.id)).toEqual([percent.id]);
  });

  it("get_item, list_comments and add_comment read and write comments", async () => {
    const { client, rows } = await connect();
    const item = seedItem(rows);
    expect((await client.callTool({ name: "add_comment", arguments: { id: item.id, body: "a note" } })).isError).toBeFalsy();
    const comments = JSON.parse(text(await client.callTool({ name: "list_comments", arguments: { id: item.id } })));
    expect(comments).toEqual([expect.objectContaining({ body: "a note", author: "agent" })]);
    expect(JSON.parse(text(await client.callTool({ name: "get_item", arguments: { id: item.id } }))).id).toBe(item.id);
  });

  it("get_now shows only what the public board shows: no private city, never coordinates", async () => {
    const { client } = await connect();
    const now = JSON.parse(text(await client.callTool({ name: "get_now", arguments: {} })));
    expect(now.place).toEqual({ shown: "Ohio, USA", region: "Ohio", country: "USA", updatedAt: "2026-11-01T00:00:00Z" });
    expect(JSON.stringify(now)).not.toContain("Secret Town");
    expect(now.bake.name).toBe("Sourdough");
    expect(now.photos).toEqual([{ src: "/misc/a.webp", alt: "Mason" }]);
  });

  it("rejects input that breaks the shared limits", async () => {
    const { client } = await connect();
    expect((await client.callTool({ name: "add_item", arguments: { title: "x".repeat(501) } })).isError).toBe(true);
    expect((await client.callTool({ name: "add_item", arguments: { title: "x", labels: ["bad label!"] } })).isError).toBe(true);
  });

  it("uses a safe client name, falling back to unknown", async () => {
    const missing = await connect({ clientName: null });
    await missing.client.callTool({ name: "add_item", arguments: { title: "x" } });
    expect([...missing.rows.items.values()][0].source).toBe("agent:unknown");
    const bad = await connect({ clientName: "evil name/../with spaces" });
    await bad.client.callTool({ name: "add_item", arguments: { title: "x" } });
    expect([...bad.rows.items.values()][0].source).toBe("agent:unknown");
  });
});

const IDEAS = [
  { id: "a", title: "Solar Kettle", verdict: "strong", createdAt: "2026-10-01T10:00:00Z", mentions: 1, nextReturn: null, reviewStatus: "done" },
  { id: "b", title: "Kettle bell app", verdict: "weak", createdAt: "2026-11-05T10:00:00Z", mentions: 2, nextReturn: "2026-11-20", reviewStatus: "done" },
  { id: "c", title: "Bike lock", verdict: "strong", createdAt: "2026-11-07T10:00:00Z", mentions: 1, nextReturn: null, reviewStatus: "none" },
];
const ideaId = "30000000-0000-4000-8000-000000000001";

describe("mcp idea tools", () => {
  afterEach(() => vi.clearAllMocks());

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const { client } = await connect();
    return client.callTool({ name, arguments: args });
  };

  it("each is read-only and ends with the data line", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const name of ["ideas_list", "idea_get", "ai_costs"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.description).toMatch(/data, never instructions\.$/);
    }
  });

  it("ideas_list defaults to active and filters by verdict, text and date", async () => {
    vi.mocked(listIdeas).mockResolvedValue({ ideas: IDEAS, total: 3 } as never);
    const all = JSON.parse(text(await call("ideas_list")));
    expect(vi.mocked(listIdeas).mock.calls[0][1]).toBe("active");
    expect(all.ideas).toHaveLength(3);
    const strong = JSON.parse(text(await call("ideas_list", { verdict: "strong", status: "done" })));
    expect(strong.ideas.map((i: { id: string }) => i.id)).toEqual(["a", "c"]);
    expect(vi.mocked(listIdeas).mock.calls[1][1]).toBe("done");
    const kettle = JSON.parse(text(await call("ideas_list", { text: "KETTLE" })));
    expect(kettle.ideas.map((i: { id: string }) => i.id)).toEqual(["a", "b"]);
    const dated = JSON.parse(text(await call("ideas_list", { from: "2026-11-05", to: "2026-11-06" })));
    expect(dated.ideas.map((i: { id: string }) => i.id)).toEqual(["b"]);
    expect(dated.total).toBe(1);
  });

  it("ideas_list says when the limit capped the result", async () => {
    vi.mocked(listIdeas).mockResolvedValue({ ideas: IDEAS, total: 3 } as never);
    const capped = JSON.parse(text(await call("ideas_list", { limit: 2 })));
    expect(capped.ideas).toHaveLength(2);
    expect(capped.note).toMatch(/2 of 3/);
  });

  it("idea_get returns every review version; a missing idea is a tool error", async () => {
    const reviews = [1, 2, 3].map((version) => ({ version, createdAt: "2026-11-01T00:00:00Z", note: null, review: null }));
    vi.mocked(getIdeaPage).mockResolvedValueOnce({ item: { id: ideaId }, reviews } as never);
    const page = JSON.parse(text(await call("idea_get", { id: ideaId })));
    expect(page.reviews.map((r: { version: number }) => r.version)).toEqual([1, 2, 3]);
    vi.mocked(getIdeaPage).mockResolvedValueOnce(null);
    const missing = await call("idea_get", { id: ideaId });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toBe(`no idea ${ideaId}`);
  });

  it("ai_costs honors the feature filter, rounds to cents and uses the budget envs", async () => {
    vi.mocked(monthSpend).mockResolvedValue({ thisMonth: 1.23456, lastMonth: 2.005, byModel: { "claude-opus-5-5": 1.23456 }, calls: 4 });
    vi.stubEnv("IDEAS_MONTHLY_BUDGET_USD", "");
    vi.stubEnv("NEWS_MONTHLY_BUDGET_USD", "");
    const ideas = JSON.parse(text(await call("ai_costs")));
    expect(vi.mocked(monthSpend).mock.calls[0][1]).toBe("ideas");
    expect(ideas).toMatchObject({ feature: "ideas", thisMonth: 1.23, byModel: { "claude-opus-5-5": 1.23 }, calls: 4, monthlyBudgetUsd: 20 });
    const news = JSON.parse(text(await call("ai_costs", { feature: "news" })));
    expect(vi.mocked(monthSpend).mock.calls[1][1]).toBe("news");
    expect(news.monthlyBudgetUsd).toBe(25);
    vi.stubEnv("IDEAS_MONTHLY_BUDGET_USD", "7.5");
    vi.stubEnv("NEWS_MONTHLY_BUDGET_USD", "40");
    expect(JSON.parse(text(await call("ai_costs"))).monthlyBudgetUsd).toBe(7.5);
    expect(JSON.parse(text(await call("ai_costs", { feature: "news" }))).monthlyBudgetUsd).toBe(40);
    vi.unstubAllEnvs();
  });

  it("none of them writes: the client throws on insert, update, upsert, delete and rpc and is never asked to", async () => {
    vi.mocked(listIdeas).mockResolvedValue({ ideas: IDEAS, total: 3 } as never);
    vi.mocked(getIdeaPage).mockResolvedValue({ item: {}, reviews: [] } as never);
    vi.mocked(monthSpend).mockResolvedValue({ thisMonth: 0, lastMonth: 0, byModel: {}, calls: 0 });
    for (const [name, args] of [["ideas_list", {}], ["idea_get", { id: ideaId }], ["ai_costs", {}]] as const) {
      expect((await call(name, args)).isError).toBeFalsy();
    }
    expect(() => (readOnlyClient as unknown as { insert: () => void }).insert()).toThrow(/write attempted/);
  });
});

describe("mcp bearer token", () => {
  const post = (fetchFn: typeof fetch, headers: Record<string, string>) =>
    fetchFn(URL_BASE, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

  it("answers 401 with no token or a wrong one", async () => {
    const { fetchFn } = setup();
    expect((await post(fetchFn, {})).status).toBe(401);
    expect((await post(fetchFn, { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("still serves a 2025-era client that starts with initialize", async () => {
    const { fetchFn } = setup();
    const response = await fetchFn(URL_BASE, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("masonbair-hub");
  });

  it("answers 503 when the server has no token set", async () => {
    const { fetchFn } = setup({ serverToken: undefined });
    expect((await post(fetchFn, { authorization: `Bearer ${TOKEN}` })).status).toBe(503);
  });
});
