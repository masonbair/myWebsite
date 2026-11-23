import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  BOARD_PHOTO_LIMIT,
  collectorPhotoLoader,
  placePhotos,
  readCollectorPhotos,
  readPlacedPhotos,
  isServedPhotoWidth,
  snapPhotoWidth,
  toCollectorPhoto,
  type CollectorPhotoRow,
} from "@/lib/collector-photos";

const row = (over: Partial<CollectorPhotoRow> = {}): CollectorPhotoRow => ({
  asset_id: "abc_DEF-123",
  taken_at: "2026-11-03T18:00:00Z",
  hidden: false,
  description: null,
  kind: null,
  places: null,
  score: null,
  labeled_at: null,
  ...over,
});

const labeled = (asset_id: string, places: string[], score: number, over: Partial<CollectorPhotoRow> = {}) =>
  row({ asset_id, places, score, kind: "portrait", description: `Mason in photo ${asset_id}.`, labeled_at: "2026-11-04T00:00:00Z", ...over });

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

  it("uses Claude's description as the alt once the photo is labeled", () => {
    expect(toCollectorPhoto(labeled("x", ["slideshow"], 5))?.alt).toBe("Mason in photo x.");
    expect(toCollectorPhoto(labeled("x", ["slideshow"], 5, { description: null }))?.alt).toBe("Photo from Mason's phone, November 2026");
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
  it("asks for visible rows only, newest taken first, with their labels", async () => {
    const { client, calls } = fakeClient([row({ asset_id: "b" }), row({ asset_id: "a" })]);
    expect((await readPlacedPhotos(client)).slideshow).toEqual([
      { src: "/photos/b", alt: "Photo from Mason's phone, November 2026" },
      { src: "/photos/a", alt: "Photo from Mason's phone, November 2026" },
    ]);
    expect(calls).toEqual([
      ["from", "collector_photo"],
      ["select", "asset_id, taken_at, hidden, description, kind, places, score, labeled_at"],
      ["eq", "hidden", false],
      ["order", "taken_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", 500],
    ]);
  });

  it("keeps hidden rows only when asked, for the hub", async () => {
    const { client, calls } = fakeClient([row({ hidden: true })]);
    expect(await readCollectorPhotos(client, { limit: 24, includeHidden: true })).toEqual([row({ hidden: true })]);
    expect(calls.some((c) => c[0] === "eq")).toBe(false);
    expect(calls.at(-1)).toEqual(["limit", 24]);
  });

  it("drops a hidden row even if the database returned one to the board", async () => {
    const { client } = fakeClient([row({ hidden: true }), labeled("h", ["slideshow", "coffee"], 9, { hidden: true })]);
    expect(await readPlacedPhotos(client)).toEqual({ slideshow: [], coffee: null });
  });

  it("throws a database error so loadNow can fall back", async () => {
    const { client } = fakeClient([], new Error("down"));
    await expect(readPlacedPhotos(client)).rejects.toThrow("down");
  });
});

describe("placePhotos", () => {
  it("fills the slideshow with photos tagged for it and ones not labeled yet, newest first", () => {
    const rows = [row({ asset_id: "new" }), labeled("tagged", ["slideshow"], 4), labeled("food", [], 8), labeled("both", ["slideshow", "coffee"], 6)];
    expect(placePhotos(rows).slideshow.map((p) => p.src)).toEqual(["/photos/new", "/photos/tagged", "/photos/both"]);
  });

  it("caps the slideshow at the board limit", () => {
    const rows = Array.from({ length: BOARD_PHOTO_LIMIT + 5 }, (_, i) => row({ asset_id: `p${i}` }));
    expect(placePhotos(rows).slideshow).toHaveLength(BOARD_PHOTO_LIMIT);
    expect(BOARD_PHOTO_LIMIT).toBe(30);
  });

  it("uses a pinned photo for its spot while it is visible, and Claude's pick once it is hidden", () => {
    const rows = [labeled("top", ["coffee"], 9), labeled("boat", ["slideshow"], 3)];
    expect(placePhotos(rows, { coffee: "boat" }).coffee?.src).toBe("/photos/boat");
    expect(placePhotos(rows, { coffee: "missing" }).coffee?.src).toBe("/photos/top");
    const hidden = [labeled("top", ["coffee"], 9), { ...labeled("boat", ["slideshow"], 3), hidden: true }];
    expect(placePhotos(hidden, { coffee: "boat" }).coffee?.src).toBe("/photos/top");
  });

  it("leads the slideshow with the pinned first photo while it is visible", () => {
    const rows = [row({ asset_id: "team" }), labeled("solo", ["slideshow"], 3), labeled("food", [], 8)];
    expect(placePhotos(rows, { slideshowFirst: "solo" }).slideshow.map((p) => p.src)).toEqual(["/photos/solo", "/photos/team"]);
    expect(placePhotos(rows, { slideshowFirst: "food" }).slideshow[0].src).toBe("/photos/food");
    const hidden = [row({ asset_id: "team" }), { ...labeled("solo", ["slideshow"], 3), hidden: true }];
    expect(placePhotos(hidden, { slideshowFirst: "solo" }).slideshow.map((p) => p.src)).toEqual(["/photos/team"]);
  });

  it("gives coffee the highest-scoring labeled photo tagged for it, newest on a tie", () => {
    const rows = [
      row({ asset_id: "unlabeled", places: ["coffee"], score: 10 }),
      labeled("coffeeNew", ["coffee"], 9),
      labeled("coffeeOld", ["coffee", "slideshow"], 9),
      labeled("coffeeLow", ["coffee"], 3),
    ];
    expect(placePhotos(rows).coffee).toEqual({ src: "/photos/coffeeNew", alt: "Mason in photo coffeeNew." });
  });

  it("leaves coffee empty when nothing is tagged for it", () => {
    expect(placePhotos([row(), labeled("a", ["slideshow"], 9)])).toMatchObject({ coffee: null });
    expect(placePhotos([])).toEqual({ slideshow: [], coffee: null });
  });

  it("never places a hidden photo", () => {
    const placed = placePhotos([labeled("h", ["slideshow", "coffee"], 10, { hidden: true }), labeled("v", ["coffee"], 2)]);
    expect(placed.coffee?.src).toBe("/photos/v");
    expect(placed.slideshow).toEqual([]);
  });
});

describe("photo widths", () => {
  it("snaps to a few served widths so visitors cannot ask for arbitrary renders", () => {
    expect([1, 256, 257, 640, 750, 1080, 1200, 3840].map(snapPhotoWidth)).toEqual([256, 256, 640, 640, 1080, 1080, 1600, 1600]);
    expect(collectorPhotoLoader({ src: "/photos/abc", width: 828 })).toBe("/photos/abc?w=1080");
    expect([256, 640, 1080, 1600].every(isServedPhotoWidth)).toBe(true);
    expect([255, 300, 3840, NaN].some(isServedPhotoWidth)).toBe(false);
  });
});
