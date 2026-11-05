import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOwner } from "@/lib/auth/require-owner";
import type { NowRows } from "@/lib/now";

const inserts: { table: string; row: Record<string, unknown> }[] = [];
let insertError: { message: string } | null = null;
let rows: NowRows | Error;

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
  readNowRows: vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  }),
}));

const { logBakeAction, setPlacePrivateAction } = await import("@/app/hub/now-actions");

const place = { city: "Kent", region: "Ohio", country: "United States", private: false, sentPrivate: false, updatedAt: "2026-11-01T00:00:00Z" };

describe("now actions", () => {
  beforeEach(() => {
    inserts.length = 0;
    insertError = null;
    rows = { place, bake: null };
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(requireOwner).mockClear();
  });

  it("logs a bake with a photo that exists in public/misc and refreshes the public board at once", async () => {
    const result = await logBakeAction({ name: "Sourdough", photo: "/misc/Mason_traveling.webp", bakedAt: "2026-11-01T08:00:00Z" });
    expect(result).toEqual({ ok: true });
    expect(requireOwner).toHaveBeenCalled();
    expect(inserts).toEqual([
      { table: "now_bake", row: { name: "Sourdough", photo: "/misc/Mason_traveling.webp", baked_at: "2026-11-01T08:00:00.000Z" } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("returns a plain error for bad input or a missing photo file and writes nothing", async () => {
    expect(await logBakeAction({ name: "Rye", photo: "https://example.com/a.webp" })).toEqual({
      ok: false,
      error: "The photo must be a file in /misc, like /misc/bread.webp.",
    });
    expect(await logBakeAction({ name: "Rye", photo: "/misc/not-a-real-file.webp" })).toEqual({
      ok: false,
      error: "There is no /misc/not-a-real-file.webp on the site. Check the file name.",
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

  it("marks a place private with a privacy row, never a place row", async () => {
    expect(await setPlacePrivateAction(true)).toEqual({ ok: true });
    expect(inserts).toEqual([
      { table: "now_place_privacy", row: { city: "Kent", region: "Ohio", country: "United States", private: true } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does nothing when the place already has that setting", async () => {
    expect(await setPlacePrivateAction(false)).toEqual({ ok: true });
    expect(inserts).toEqual([]);
  });

  it("refuses with a clear message when the database read fails or has no place", async () => {
    rows = new Error("connection refused");
    expect(await setPlacePrivateAction(true)).toEqual({
      ok: false,
      error: "Could not read the current place from the database. Nothing changed.",
    });
    rows = { place: null, bake: null };
    expect(await setPlacePrivateAction(true)).toEqual({
      ok: false,
      error: "There is no place in the database yet, so there is nothing to mark.",
    });
    expect(inserts).toEqual([]);
  });

  it("will not make public a place the phone sent as private", async () => {
    rows = { place: { ...place, private: true, sentPrivate: true }, bake: null };
    expect(await setPlacePrivateAction(false)).toEqual({ ok: false, error: "The phone sent this place as private, so it stays private." });
    expect(inserts).toEqual([]);
  });

  it("refuses a value that is not true or false", async () => {
    expect(await setPlacePrivateAction("yes" as unknown as boolean)).toEqual({ ok: false, error: "Bad request." });
    expect(inserts).toEqual([]);
  });
});
