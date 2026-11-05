import { describe, expect, it } from "vitest";
import { MAX_MCP_BODY_BYTES, mcpRequestGuard, withCappedBody } from "@/lib/hub/mcp-guard";

const request = (headers: Record<string, string>) => new Request("https://hub.test/api/mcp/mcp", { method: "POST", headers });

describe("mcp request guard", () => {
  it("refuses any request with an Origin header", () => {
    expect(mcpRequestGuard(request({ origin: "https://evil.test" }))?.status).toBe(403);
    expect(mcpRequestGuard(request({ origin: "null" }))?.status).toBe(403);
  });

  it("refuses a body over 1 MB, or a length that is not a number", () => {
    expect(mcpRequestGuard(request({ "content-length": String(MAX_MCP_BODY_BYTES + 1) }))?.status).toBe(413);
    expect(mcpRequestGuard(request({ "content-length": "lots" }))?.status).toBe(413);
  });

  it("lets an agent request of normal size through", () => {
    expect(mcpRequestGuard(request({ "content-length": String(MAX_MCP_BODY_BYTES) }))).toBeNull();
    expect(mcpRequestGuard(request({}))).toBeNull();
  });

  it("caps a chunked body that sends no length", async () => {
    const chunked = (bytes: number) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let sent = 0; sent < bytes; sent += 64 * 1024) controller.enqueue(new Uint8Array(Math.min(64 * 1024, bytes - sent)));
          controller.close();
        },
      });
      return new Request("https://hub.test/api/mcp/mcp", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    };
    const tooBig = await withCappedBody(chunked(MAX_MCP_BODY_BYTES + 1));
    expect(tooBig).toBeInstanceOf(Response);
    expect((tooBig as Response).status).toBe(413);
    const fine = await withCappedBody(chunked(1000));
    expect(fine).toBeInstanceOf(Request);
    expect((await (fine as Request).arrayBuffer()).byteLength).toBe(1000);
  });
});
