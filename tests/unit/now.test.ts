import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLocation } from "@/lib/location";
import { loadNow, parseNow, readNow } from "@/lib/now";

describe("parseNow", () => {
  it("strips unknown keys", () => {
    const r = parseNow({
      place: { city: "Kent", region: "Ohio", country: "United States", private: true, updatedAt: "2026-11-01T00:00:00Z", lat: 1, lng: 2 },
      countriesVisited: 3,
    });
    expect(r.place).not.toBeNull();
    expect("lat" in r.place!).toBe(false);
    expect(JSON.stringify(r)).not.toContain("lat");
  });

  it("drops photos with non-/misc paths", () => {
    const r = parseNow({
      photos: [
        { src: "https://evil/x.jpg", alt: "a" },
        { src: "/misc/../.env", alt: "b" },
        { src: "/misc/a.webp", alt: "ok" },
        { src: "/misc/b.webp" },
      ],
    });
    expect(r.photos).toEqual([{ src: "/misc/a.webp", alt: "ok" }]);
  });

  it("takes phone photos at /photos/<asset id> and nothing else under /photos", () => {
    const r = parseNow({
      photos: [
        { src: "/photos/abc_DEF-123", alt: "ok" },
        { src: "/photos/../misc/a.webp", alt: "a" },
        { src: "/photos/a/b", alt: "b" },
        { src: "/photos/a.jpg", alt: "c" },
        { src: "/photos/", alt: "d" },
        { src: "/photos/abc?w=1", alt: "e" },
      ],
    });
    expect(r.photos).toEqual([{ src: "/photos/abc_DEF-123", alt: "ok" }]);
  });

  it("keeps a bake photo to /misc, since the hub checks it exists in public/", () => {
    expect(parseNow({ bake: { name: "Rye", photo: "/photos/abc", bakedAt: "2026-11-01T10:00:00Z" } }).bake?.photo).toBeNull();
  });

  it("tolerates garbage", () => {
    expect(parseNow(null)).toEqual({ place: null, countriesVisited: 0, bake: null, photos: [] });
    expect(parseNow("x")).toEqual({ place: null, countriesVisited: 0, bake: null, photos: [] });
    expect(parseNow({ countriesVisited: -2.5, place: { city: "" }, bake: { name: "x", bakedAt: "nope" } })).toEqual({
      place: null,
      countriesVisited: 0,
      bake: null,
      photos: [],
    });
  });

  it("keeps a private place the phone sent without a city", () => {
    const r = parseNow({ place: { city: null, region: "Ohio", country: "United States", private: true, updatedAt: "2026-11-01T00:00:00Z" } });
    expect(r.place).toEqual({ city: null, region: "Ohio", country: "United States", private: true, updatedAt: "2026-11-01T00:00:00Z" });
    expect(formatLocation(r.place!)).toBe("Ohio, United States");
    expect(parseNow({ place: { city: "  ", region: "", country: "Portugal", private: true, updatedAt: "2026-11-01T00:00:00Z" } }).place).toMatchObject({
      city: null,
    });
  });

  it("drops a public place with no city", () => {
    for (const city of [null, undefined, "", "  "]) {
      expect(parseNow({ place: { city, region: "Ohio", country: "United States", private: false, updatedAt: "2026-11-01T00:00:00Z" } }).place).toBeNull();
    }
  });

  it("keeps a valid bake", () => {
    const r = parseNow({ bake: { name: "Sourdough", photo: "/misc/a.webp", bakedAt: "2026-11-01T10:00:00Z" } });
    expect(r.bake).toEqual({ name: "Sourdough", photo: "/misc/a.webp", bakedAt: "2026-11-01T10:00:00Z" });
  });
});

describe("loadNow", () => {
  const file = parseNow({
    place: { city: "Lisbon", region: "Lisboa", country: "Portugal", updatedAt: "2026-10-01T00:00:00Z" },
    countriesVisited: 23,
    bake: { name: "Focaccia", bakedAt: "2026-10-02T00:00:00Z" },
    photos: [{ src: "/misc/a.webp", alt: "a" }],
  });
  const shownPlace = { city: "Testerville", region: "Ohio", country: "United States", private: true, updatedAt: "2026-11-04T00:00:00Z" };
  const dbPlace = { ...shownPlace, sentPrivate: false };
  const dbBake = { name: "Sourdough", photo: null, bakedAt: "2026-11-05T09:00:00Z" };

  afterEach(() => vi.unstubAllEnvs());

  it("returns the JSON file's data when the database is empty", async () => {
    expect(await loadNow({ file: async () => file, rows: async () => ({ place: null, bake: null }) })).toEqual(file);
  });

  it("returns content/now.json when no database is configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NOW_FIXTURE", "");
    expect(await loadNow()).toEqual(await readNow());
  });

  it("falls back to the file when the database errors", async () => {
    const rows = async () => {
      throw new Error("relation now_bake does not exist");
    };
    expect(await loadNow({ file: async () => file, rows })).toEqual(file);
  });

  it("takes each field from the database when it has one, keeping the rest from the file", async () => {
    const onlyBake = await loadNow({ file: async () => file, rows: async () => ({ place: null, bake: dbBake }) });
    expect(onlyBake).toEqual({ ...file, bake: dbBake });
    const both = await loadNow({ file: async () => file, rows: async () => ({ place: dbPlace, bake: dbBake }) });
    // sentPrivate is hub-only, so it never reaches the board or get_now.
    expect(both).toEqual({ ...file, place: shownPlace, bake: dbBake });
  });

  it("puts phone photos before the file's, without repeating one", async () => {
    const phone = [
      { src: "/photos/new", alt: "Photo from Mason's phone, November 2026" },
      { src: "/misc/a.webp", alt: "dup" },
    ];
    const now = await loadNow({ file: async () => file, rows: async () => null, photos: async () => phone });
    expect(now.photos).toEqual(phone);
    const more = await loadNow({ file: async () => file, rows: async () => null, photos: async () => phone.slice(0, 1) });
    expect(more.photos).toEqual([phone[0], { src: "/misc/a.webp", alt: "a" }]);
  });

  it("shows only the file's photos when the photo query fails", async () => {
    const photos = async () => {
      throw new Error("relation collector_photo does not exist");
    };
    expect(await loadNow({ file: async () => file, rows: async () => null, photos })).toEqual(file);
  });

  it("a private database place still shows only region and country", async () => {
    const now = await loadNow({ file: async () => file, rows: async () => ({ place: dbPlace, bake: null }) });
    expect(formatLocation(now.place!)).toBe("Ohio, United States");
  });
});

describe("0005_now.sql", () => {
  it("has no latitude, longitude or other coordinate columns", async () => {
    const sql = await readFile(path.join(__dirname, "../../supabase/migrations/0005_now.sql"), "utf8");
    const code = sql.replace(/--.*$/gm, "");
    expect(code).toContain("create table public.now_place");
    expect(code).not.toMatch(/lat|lon|lng|coord|geo/i);
  });
});

describe("0007_collector.sql", () => {
  it("adds no latitude, longitude or other coordinate columns", async () => {
    const sql = await readFile(path.join(__dirname, "../../supabase/migrations/0007_collector.sql"), "utf8");
    const code = sql.replace(/--.*$/gm, "");
    expect(code).toContain("create table public.collector_photo");
    expect(code).not.toMatch(/lat|lon|lng|coord|geo|gps|exif/i);
  });
});
