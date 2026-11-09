import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  sessionClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
  serviceClient: () => ({}),
}));
vi.mock("@/lib/auth/owner", () => ({ isOwnerUser: () => false }));
vi.mock("@/lib/auth/require-owner", () => ({ recordOwner: vi.fn() }));

const { GET } = await import("@/app/hub/auth/callback/route");

async function callback(query: string, returnCookie?: string) {
  const headers = returnCookie === undefined ? undefined : { cookie: `hub_return=${returnCookie}` };
  const res = await GET(new NextRequest(`https://masonbair.com/hub/auth/callback?${query}`, { headers }));
  return { location: res.headers.get("location") ?? "", setCookie: res.headers.get("set-cookie") ?? "" };
}

describe("auth callback", () => {
  beforeEach(() => {
    exchange.mockReset();
    exchange.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  });

  it("goes to /hub with no return cookie", async () => {
    expect((await callback("code=c")).location).toBe("https://masonbair.com/hub");
  });

  it("goes back to the hub path in the return cookie and clears it", async () => {
    const { location, setCookie } = await callback("code=c", "%2Fhub%2Fideas%2Fabc-123");
    expect(location).toBe("https://masonbair.com/hub/ideas/abc-123");
    expect(setCookie).toMatch(/^hub_return=;/);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/Path=\/hub\/auth\/callback/i);
  });

  it("ignores a next query parameter", async () => {
    expect((await callback("code=c&next=%2Fhub%2Fideas%2Fabc")).location).toBe("https://masonbair.com/hub");
  });

  it.each(["%2F%2Fevil.com", "%2Fhub%2F%2Fevil.com", "https%3A%2F%2Fevil.com", "%2F%5Cevil", "%2Fhub%2Fideas%3Fx%3D1", "%2Fhubx"])(
    "falls back to /hub for a hostile cookie %s and still clears it",
    async (hostile) => {
      const { location, setCookie } = await callback("code=c", hostile);
      expect(location).toBe("https://masonbair.com/hub");
      expect(setCookie).toMatch(/Max-Age=0/i);
    },
  );

  it("keeps a valid return path on the retry link when sign in fails", async () => {
    exchange.mockResolvedValue({ data: { user: null }, error: new Error("bad code") });
    expect((await callback("code=c", "%2Fhub%2Fideas%2Fabc")).location).toBe(
      "https://masonbair.com/hub/login?error=1&next=%2Fhub%2Fideas%2Fabc",
    );
    expect((await callback("code=c", "%2F%2Fevil.com")).location).toBe("https://masonbair.com/hub/login?error=1");
  });
});
