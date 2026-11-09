import { randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";
import { HUB_E2E_AGENT_TOKEN, HUB_PORT } from "./hub-ports";
import { seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// Runs only in the "hub" project: an MCP client over real HTTP to the dev server, writing to local Supabase.

const MCP_URL = `http://localhost:${HUB_PORT}/api/mcp/mcp`;

test.describe("hub agent connector", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test("an MCP client adds an item that Mason then sees in his inbox", async ({ context, page }) => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${HUB_E2E_AGENT_TOKEN}`, "x-client-name": "e2e-agent" } },
    });
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_comment",
        "add_item",
        "find_items",
        "get_item",
        "get_now",
        "list_comments",
        "merge_duplicate",
        "news_costs",
        "news_get_issue",
        "news_movers",
        "news_search",
        "news_trend",
        "update_item",
      ],
    );
    const title = `e2e mcp ${randomUUID().slice(0, 8)}`;
    const result = await client.callTool({ name: "add_item", arguments: { title } });
    expect(result.isError).toBeFalsy();
    const item = JSON.parse((result.content as { text: string }[])[0].text) as { id: string; source: string; list: string };
    expect(item).toMatchObject({ source: "agent:e2e-agent", list: "inbox" });
    await client.close();

    const { data } = await serviceClient().from("audit_log").select("actor, action").eq("item_id", item.id);
    expect(data).toEqual([{ actor: "agent:e2e-agent", action: "add" }]);

    await signInAs(context, await seededOwner());
    await page.goto("/hub");
    await expect(page.getByRole("region", { name: "Unsorted" }).getByRole("link", { name: title })).toBeVisible();
  });

  test("refuses a request without the agent token", async ({ request }) => {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    const headers = { accept: "application/json, text/event-stream" };
    expect((await request.post(MCP_URL, { data: body, headers })).status()).toBe(401);
    expect((await request.post(MCP_URL, { data: body, headers: { ...headers, authorization: "Bearer wrong" } })).status()).toBe(401);
  });

  test("refuses a browser origin and a body over 1 MB before anything else", async ({ request }) => {
    const auth = { authorization: `Bearer ${HUB_E2E_AGENT_TOKEN}`, accept: "application/json, text/event-stream" };
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    expect((await request.post(MCP_URL, { data: body, headers: { ...auth, origin: "http://evil.test" } })).status()).toBe(403);
    const big = { ...body, params: { pad: "x".repeat(1024 * 1024) } };
    expect((await request.post(MCP_URL, { data: big, headers: auth })).status()).toBe(413);
  });
});
