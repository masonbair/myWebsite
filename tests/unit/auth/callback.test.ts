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

async function landing(query: string): Promise<string> {
  const res = await GET(new NextRequest(`https://masonbair.com/hub/auth/callback?${query}`));
  return res.headers.get("location") ?? "";
}

describe("auth callback", () => {
  beforeEach(() => {
    exchange.mockReset();
    exchange.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  });

  it("goes to /hub with no next", async () => {
    expect(await landing("code=c")).toBe("https://masonbair.com/hub");
  });

  it("goes back to a valid hub path", async () => {
    expect(await landing("code=c&next=%2Fhub%2Fideas%2Fabc-123")).toBe("https://masonbair.com/hub/ideas/abc-123");
  });

  it.each(["%2F%2Fevil.com", "%2Fhub%2F%2Fevil.com", "https%3A%2F%2Fevil.com", "%2F%5Cevil", "%2Fhub%2Fideas%3Fx%3D1", "%2Fhubx"])(
    "falls back to /hub for next=%s",
    async (next) => {
      expect(await landing(`code=c&next=${next}`)).toBe("https://masonbair.com/hub");
    },
  );

  it("keeps a valid next when sign in fails, so a retry still comes back", async () => {
    exchange.mockResolvedValue({ data: { user: null }, error: new Error("bad code") });
    expect(await landing("code=c&next=%2Fhub%2Fideas%2Fabc")).toBe("https://masonbair.com/hub/login?error=1&next=%2Fhub%2Fideas%2Fabc");
    expect(await landing("code=c&next=%2F%2Fevil.com")).toBe("https://masonbair.com/hub/login?error=1");
  });
});
