import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  collectorPhotoLoader,
  readBoardPhotos,
  readCollectorPhotos,
  snapPhotoWidth,
  toCollectorPhoto,
  type CollectorPhotoRow,
} from "@/lib/collector-photos";

const row = (over: Partial<CollectorPhotoRow> = {}): CollectorPhotoRow => ({
  asset_id: "abc_DEF-123",
  taken_at: "2026-11-03T18:00:00Z",
  width: 1800,
  height: 2400,
  hidden: false,
  ...over,
});

/** Records the query the code builds, and answers it with the given rows. */
function fakeClient(rows: CollectorPhotoRow[], error: Error | null = null) {
  const calls: unknown[][] = [];
  const builder = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), builder),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), builder),
    order: (...a: unknown[]) => (calls.push(["order", ...a]), builder),
    limit: (...a: unknown[]) => (calls.push(["limit", ...a]), Promise.resolve({ data: error ? null : rows, error })),
  };
  const client = { from: (table: string) => (calls.push(["from", table]), builder) } as unknown as SupabaseClient;
  return { client, calls };
}

describe("toCollectorPhoto", () => {
  it("serves a visible row from the site's own route, with a generic month-only alt", () => {
    expect(toCollectorPhoto(row())).toEqual({ src: "/photos/abc_DEF-123", alt: "Photo from Mason's phone, November 2026" });
  });

  it("drops hidden rows, unsafe asset ids and bad dates", () => {
    expect(toCollectorPhoto(row({ hidden: true }))).toBeNull();
    for (const asset_id of ["../x", "a/b", "a.jpg", "", "a b", "%2e%2e", "x".repeat(201)]) {
      expect(toCollectorPhoto(row({ asset_id })), asset_id).toBeNull();
    }
    expect(toCollectorPhoto(row({ taken_at: "nope" }))).toBeNull();
  });
});

describe("readCollectorPhotos", () => {
  it("asks for visible rows only, newest taken first, at most 12 for the board", async () => {
    const { client, calls } = fakeClient([row({ asset_id: "b" }), row({ asset_id: "a" })]);
    expect(await readBoardPhotos(client)).toEqual([
      { src: "/photos/b", alt: "Photo from Mason's phone, November 2026" },
      { src: "/photos/a", alt: "Photo from Mason's phone, November 2026" },
    ]);
    expect(calls).toEqual([
      ["from", "collector_photo"],
      ["select", "asset_id, taken_at, width, height, hidden"],
      ["eq", "hidden", false],
      ["order", "taken_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", 12],
    ]);
  });

  it("keeps hidden rows only when asked, for the hub", async () => {
    const { client, calls } = fakeClient([row({ hidden: true })]);
    expect(await readCollectorPhotos(client, { limit: 24, includeHidden: true })).toEqual([row({ hidden: true })]);
    expect(calls.some((c) => c[0] === "eq")).toBe(false);
    expect(calls.at(-1)).toEqual(["limit", 24]);
  });

  it("drops a hidden row even if the database returned one to the board", async () => {
    const { client } = fakeClient([row({ hidden: true })]);
    expect(await readBoardPhotos(client)).toEqual([]);
  });

  it("throws a database error so loadNow can fall back", async () => {
    const { client } = fakeClient([], new Error("down"));
    await expect(readBoardPhotos(client)).rejects.toThrow("down");
  });
});

describe("photo widths", () => {
  it("snaps to a few served widths so visitors cannot ask for arbitrary renders", () => {
    expect([1, 256, 257, 640, 750, 1080, 1200, 3840].map(snapPhotoWidth)).toEqual([256, 256, 640, 640, 1080, 1080, 1600, 1600]);
    expect(collectorPhotoLoader({ src: "/photos/abc", width: 828 })).toBe("/photos/abc?w=1080");
  });
});
