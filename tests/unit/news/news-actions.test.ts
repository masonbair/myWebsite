import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOwner } from "@/lib/auth/require-owner";

const rpcCalls: { fn: string; args: unknown }[] = [];
let rpcResult: { data: unknown; error: { message: string } | null };
let requestHeaders: Record<string, string>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers(requestHeaders)) }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: vi.fn(async () => ({ userId: "owner" })) }));
vi.mock("@/lib/supabase/server", () => ({
  sessionClient: vi.fn(async () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  })),
}));

const { retryIssue } = await import("@/app/hub/news-actions");

const id = "3f2b8c1e-0d4a-4b7e-9a51-6c2f1d8e7a90";

describe("retryIssue", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcResult = { data: true, error: null };
    requestHeaders = { host: "masonbair.com", origin: "https://masonbair.com" };
    vi.mocked(requireOwner).mockReset();
    vi.mocked(requireOwner).mockResolvedValue({ userId: "owner" });
    vi.mocked(revalidatePath).mockClear();
  });

  it("calls news_retry for the owner and refreshes the page", async () => {
    expect(await retryIssue(id)).toEqual({ ok: true });
    expect(rpcCalls).toEqual([{ fn: "news_retry", args: { p_id: id } }]);
    expect(revalidatePath).toHaveBeenCalledWith("/hub/news");
  });

  it("refuses a signed-out caller before touching the database", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(retryIssue(id)).rejects.toThrow("NEXT_REDIRECT");
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a non-owner before touching the database", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(retryIssue(id)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a request from another site", async () => {
    requestHeaders = { host: "masonbair.com", origin: "https://evil.example" };
    expect(await retryIssue(id)).toEqual({ ok: false, error: "Bad request." });
    expect(rpcCalls).toEqual([]);
  });

  it("refuses an id that is not a uuid", async () => {
    expect(await retryIssue("1; drop table news_issues")).toEqual({ ok: false, error: "Bad request." });
    expect(rpcCalls).toEqual([]);
  });

  it("says so when the issue is not failed", async () => {
    rpcResult = { data: false, error: null };
    expect(await retryIssue(id)).toEqual({ ok: false, error: "Only an issue that failed can be retried." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a plain error when the database call fails", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    expect(await retryIssue(id)).toEqual({ ok: false, error: "Could not retry. Try again." });
  });
});
