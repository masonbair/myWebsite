import { randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "@/lib/hub/mcp-tools";
import { createHubStore } from "@/lib/hub/store";
import { parseNow } from "@/lib/now";

// Same gate as store.integration.test.ts: HUB_TEST_DB_URL=1 plus the local API URL and keys from `supabase status -o env`.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("mcp tools against local Supabase", () => {
  const db = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = "integration-agent-token";

  async function connect(clientName: string) {
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) =>
      handleMcpRequest(new Request(input, init), {
        token,
        storeFor: (client) => createHubStore(db(), { kind: "agent", client }),
        readNow: async () => parseNow(null),
      })) as typeof fetch;
    const transport = new StreamableHTTPClientTransport(new URL("https://hub.test/api/mcp/mcp"), {
      fetch: fetchFn,
      requestInit: { headers: { authorization: `Bearer ${token}`, "x-client-name": clientName } },
    });
    const client = new Client({ name: "integration", version: "1.0.0" });
    await client.connect(transport);
    return async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { text: string }[]).map((c) => c.text).join("\n");
      if (result.isError) throw new Error(text);
      return JSON.parse(text);
    };
  }

  it("writes an audit_log row naming the client for every write tool", async () => {
    const clientName = `it-${randomUUID().slice(0, 8)}`;
    const call = await connect(clientName);
    const older = await call("add_item", { title: `mcp older ${clientName}` });
    const newer = await call("add_item", { title: `mcp newer ${clientName}` });
    expect(older).toMatchObject({ list: "inbox", source: `agent:${clientName}` });
    await call("update_item", { id: older.id, description: "updated" });
    await call("add_comment", { id: older.id, body: "a comment" });
    await call("merge_duplicate", { newer: newer.id, older: older.id, note: "same thing" });
    const { data, error } = await db().from("audit_log").select("action, item_id").eq("actor", `agent:${clientName}`);
    if (error) throw error;
    const rows = data.map((row) => `${row.action} ${row.item_id === older.id ? "older" : "newer"}`).sort();
    expect(rows).toEqual(["add newer", "add older", "archive newer", "comment older", "update older"]);
  });

  it("refuses the claude label on update and leaves the row unchanged", async () => {
    const call = await connect("it-claude");
    const item = await call("add_item", { title: `mcp claude ${randomUUID()}`, labels: ["todo"] });
    await expect(call("update_item", { id: item.id, labels: ["todo", "claude"] })).rejects.toThrow(/claude/);
    const { data } = await db().from("items").select("labels").eq("id", item.id).single();
    expect(data?.labels).toEqual(["todo"]);
  });

  it("find_items text search takes wildcards and filter syntax literally", async () => {
    const call = await connect("it-search");
    const tag = randomUUID().slice(0, 8);
    const odd = await call("add_item", { title: `mcp ${tag} 50%_off*(a,b)"q"\\` });
    await call("add_item", { title: `mcp ${tag} 50 percent off` });
    const ids = async (text: string) => (await call("find_items", { text })).map((i: { id: string }) => i.id);
    expect(await ids(`${tag} 50%_OFF*(A,B)"Q"\\`)).toEqual([odd.id]);
    expect(await ids(`${tag} 50%`)).toEqual([odd.id]);
    expect(await ids(`${tag} 50_`)).toEqual([]);
    expect(await ids(`${tag} 50*off`)).toEqual([]);
  });
});
