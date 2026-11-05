import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOwner } from "@/lib/auth/require-owner";
import type { NowData } from "@/lib/now";

const inserts: { table: string; row: Record<string, unknown> }[] = [];
let insertError: { message: string } | null = null;
let now: NowData;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: vi.fn(async () => ({ userId: "owner" })) }));
vi.mock("@/lib/supabase/server", () => ({
  serviceClient: vi.fn(),
  sessionClient: vi.fn(async () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (!insertError) inserts.push({ table, row });
        return { error: insertError };
      },
    }),
  })),
}));
vi.mock("@/lib/now", async (original) => ({
  ...(await original<typeof import("@/lib/now")>()),
  loadNow: vi.fn(async () => now),
}));

const { logBakeAction, setPlacePrivateAction } = await import("@/app/hub/now-actions");

const place = { city: "Kent", region: "Ohio", country: "United States", private: false, updatedAt: "2026-11-01T00:00:00Z" };

describe("now actions", () => {
  beforeEach(() => {
    inserts.length = 0;
    insertError = null;
    now = { place, countriesVisited: 3, bake: null, photos: [] };
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(requireOwner).mockClear();
  });

  it("logs a bake as the owner and refreshes the public board at once", async () => {
    expect(await logBakeAction({ name: "Sourdough", photo: "/misc/bread.webp", bakedAt: "2026-11-01T08:00:00Z" })).toEqual({ ok: true });
    expect(requireOwner).toHaveBeenCalled();
    expect(inserts).toEqual([
      { table: "now_bake", row: { name: "Sourdough", photo: "/misc/bread.webp", baked_at: "2026-11-01T08:00:00.000Z" } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("returns a plain error for bad input and writes nothing", async () => {
    expect(await logBakeAction({ name: "Rye", photo: "https://example.com/a.webp" })).toEqual({
      ok: false,
      error: "The photo must be a file in /misc, like /misc/bread.webp.",
    });
    expect(inserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("stops before writing when the owner check fails", async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(logBakeAction({ name: "Rye" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(setPlacePrivateAction(true)).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(requireOwner).mockResolvedValue({ userId: "owner" });
    expect(inserts).toEqual([]);
  });

  it("marks a place private by adding a copy of the latest row", async () => {
    expect(await setPlacePrivateAction(true)).toEqual({ ok: true });
    expect(inserts).toEqual([
      {
        table: "now_place",
        row: { city: "Kent", region: "Ohio", country: "United States", private: true, updated_at: "2026-11-01T00:00:00Z" },
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does nothing when the place already has that setting, or there is no place", async () => {
    expect(await setPlacePrivateAction(false)).toEqual({ ok: true });
    now = { ...now, place: null };
    expect(await setPlacePrivateAction(true)).toEqual({ ok: false, error: "There is no place to change yet." });
    expect(inserts).toEqual([]);
  });

  it("refuses a value that is not true or false", async () => {
    expect(await setPlacePrivateAction("yes" as unknown as boolean)).toEqual({ ok: false, error: "Bad request." });
    expect(inserts).toEqual([]);
  });
});
