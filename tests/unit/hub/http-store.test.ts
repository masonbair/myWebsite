import { describe, expect, it } from "vitest";
import { createHttpStore } from "@/lib/hub/http-store";
import { ForbiddenError } from "@/lib/hub/rules";
import { seedItem, workerHarness } from "./worker-harness";

describe("createHttpStore", () => {
  it("refuses plain http except to this machine, so the token never crosses the network in clear", () => {
    expect(() => createHttpStore("http://masonbair.com", "t", "r", fetch)).toThrow(/https/);
    expect(() => createHttpStore("http://localhost:3000", "t", "r", fetch)).not.toThrow();
    expect(() => createHttpStore("http://127.0.0.1:3000", "t", "r", fetch)).not.toThrow();
  });

  it("sends the token and run id on every call", async () => {
    const seen: Headers[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    await createHttpStore("https://hub.test/", "secret", "run-9", fetchFn).health();
    expect(seen[0].get("authorization")).toBe("Bearer secret");
    expect(seen[0].get("x-hub-run-id")).toBe("run-9");
  });

  it("turns a 403 into ForbiddenError and a 409 claim into false", async () => {
    const h = workerHarness();
    const t = seedItem(h.rows, { labels: ["todo"] });
    await expect(h.hub.updateItem(t.id, { labels: ["todo", "claude"] })).rejects.toThrow(ForbiddenError);
    expect(await h.hub.claim(t.id)).toBe(false);
  });
});
