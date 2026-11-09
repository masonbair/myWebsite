import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ set: vi.fn(), host: "masonbair.com" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: jar.set }),
  headers: async () => new Headers({ host: jar.host }),
}));

const { rememberReturn } = await import("@/app/hub/login/actions");

describe("rememberReturn", () => {
  beforeEach(() => {
    jar.set.mockReset();
    jar.host = "masonbair.com";
  });

  it("stores a plain hub path in a short-lived, callback-only, httpOnly cookie", async () => {
    await rememberReturn("/hub/ideas/abc");
    expect(jar.set).toHaveBeenCalledWith("hub_return", "/hub/ideas/abc", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/hub/auth/callback",
      maxAge: 600,
    });
  });

  it("drops Secure only on localhost", async () => {
    jar.host = "localhost:3210";
    await rememberReturn("/hub/ideas/abc");
    expect(jar.set.mock.calls[0][2]).toMatchObject({ secure: false });
  });

  it.each(["//evil.com", "/hub//evil.com", "https://evil.com", "/hub/ideas?x=1", "/hub"])("clears instead of storing %j", async (hostile) => {
    await rememberReturn(hostile);
    expect(jar.set).toHaveBeenCalledWith("hub_return", "", { path: "/hub/auth/callback", maxAge: 0 });
  });
});
