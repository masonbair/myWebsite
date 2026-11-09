import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

const request = (path: string, auth?: string) =>
  new NextRequest(`https://masonbair.com${path}`, { method: "POST", headers: auth ? { authorization: auth } : {} });

// With no Supabase env the session read finds nobody signed in, so a browser-gated path answers 401.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});

describe("proxy machine API gate", () => {
  it("lets a bearer POST to the recording intake through to the route, which checks the token", async () => {
    const res = await proxy(request("/api/hub/ideas/recording", "Bearer anything"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("answers 401 at once when the recording intake gets no bearer", async () => {
    expect((await proxy(request("/api/hub/ideas/recording"))).status).toBe(401);
  });

  it("keeps every other ideas path behind the browser session", async () => {
    for (const path of ["/api/hub/ideas/recordings", "/api/hub/ideas/other", "/api/hub/ideas"]) {
      const res = await proxy(request(path, "Bearer anything"));
      expect(res.status).toBe(401);
      expect(res.headers.get("x-middleware-next")).toBeNull();
    }
  });
});
