import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOwnerIdentity, isOwnerUser } from "@/lib/auth/owner";

const OWNER_ID = "77211262";

const session = vi.hoisted(() => ({
  user: null as Partial<User> | null,
  isOwner: false as boolean,
  rpcError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  sessionClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: session.user ? null : { message: "no session" } }) },
    rpc: async () => ({ data: session.isOwner, error: session.rpcError }),
  }),
  serviceClient: () => {
    throw new Error("requireOwner must not use the service client");
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));

function githubUser(providerId: string, provider = "github"): Partial<User> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    identities: [
      { id: providerId, identity_id: "i", user_id: "u", provider, identity_data: { provider_id: providerId } },
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("HUB_OWNER_GITHUB_ID", OWNER_ID);
  session.user = null;
  session.isOwner = false;
  session.rpcError = null;
});

afterEach(() => vi.unstubAllEnvs());

describe("isOwnerIdentity", () => {
  it("accepts Mason's GitHub id", () => {
    expect(isOwnerIdentity({ provider: "github", providerId: OWNER_ID })).toBe(true);
  });

  it("refuses any other GitHub id", () => {
    expect(isOwnerIdentity({ provider: "github", providerId: "1" })).toBe(false);
    expect(isOwnerIdentity({ provider: "github", providerId: `${OWNER_ID}0` })).toBe(false);
    expect(isOwnerIdentity({ provider: "github", providerId: "" })).toBe(false);
  });

  it("refuses the right id from another provider", () => {
    expect(isOwnerIdentity({ provider: "email", providerId: OWNER_ID })).toBe(false);
    expect(isOwnerIdentity({ provider: "gitlab", providerId: OWNER_ID })).toBe(false);
  });

  it("fails closed when the owner id is missing or malformed", () => {
    vi.stubEnv("HUB_OWNER_GITHUB_ID", "");
    expect(isOwnerIdentity({ provider: "github", providerId: "" })).toBe(false);
    expect(isOwnerIdentity({ provider: "github", providerId: OWNER_ID })).toBe(false);
    vi.stubEnv("HUB_OWNER_GITHUB_ID", "masonbair");
    expect(isOwnerIdentity({ provider: "github", providerId: "masonbair" })).toBe(false);
  });

  it("takes an explicit owner id for the mobile app", () => {
    vi.stubEnv("HUB_OWNER_GITHUB_ID", "");
    expect(isOwnerIdentity({ provider: "github", providerId: OWNER_ID }, OWNER_ID)).toBe(true);
  });
});

describe("isOwnerUser", () => {
  it("matches on the GitHub identity id", () => {
    expect(isOwnerUser(githubUser(OWNER_ID) as User)).toBe(true);
    expect(isOwnerUser(githubUser("42") as User)).toBe(false);
    expect(isOwnerUser(githubUser(OWNER_ID, "email") as User)).toBe(false);
    expect(isOwnerUser({ id: "x" } as User)).toBe(false);
  });

  it("ignores user_metadata, which the user can edit", () => {
    const user = { id: "x", identities: [], user_metadata: { provider_id: OWNER_ID } } as unknown as User;
    expect(isOwnerUser(user)).toBe(false);
  });
});

describe("requireOwner", () => {
  const load = async () => (await import("@/lib/auth/require-owner")).requireOwner;

  it("sends a signed-out visitor to the login page", async () => {
    await expect((await load())()).rejects.toThrow("redirect:/hub/login");
  });

  it("shows a 404 to a signed-in stranger", async () => {
    session.user = githubUser("42");
    session.isOwner = true;
    await expect((await load())()).rejects.toThrow("redirect:/hub/missing");
  });

  it("shows a 404 when the GitHub id matches but hub_owner has no row", async () => {
    session.user = githubUser(OWNER_ID);
    session.isOwner = false;
    await expect((await load())()).rejects.toThrow("redirect:/hub/missing");
  });

  it("shows a 404 when the owner check errors", async () => {
    session.user = githubUser(OWNER_ID);
    session.isOwner = true;
    session.rpcError = { message: "boom" };
    await expect((await load())()).rejects.toThrow("redirect:/hub/missing");
  });

  it("fails closed when HUB_OWNER_GITHUB_ID is missing", async () => {
    vi.stubEnv("HUB_OWNER_GITHUB_ID", "");
    session.user = githubUser(OWNER_ID);
    session.isOwner = true;
    await expect((await load())()).rejects.toThrow("redirect:/hub/missing");
  });

  it("returns the owner's user id", async () => {
    session.user = githubUser(OWNER_ID);
    session.isOwner = true;
    await expect((await load())()).resolves.toEqual({ userId: "00000000-0000-0000-0000-000000000001" });
  });
});
