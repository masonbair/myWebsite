import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, handleMcpRequest } from "@/lib/hub/mcp-tools";
import type { NowData } from "@/lib/now";
import { createFakeStore } from "./fake-store";
import { seedItem } from "./worker-harness";

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
      ["add_comment", "add_item", "find_items", "get_item", "get_now", "list_comments", "merge_duplicate", "update_item"].sort(),
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
    const note = rows.comments.find((c) => c.itemId === newer.id)?.body ?? "";
    expect(note).toContain(older.url);
    expect(note).toContain("same task");
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
