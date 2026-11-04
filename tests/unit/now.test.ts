import { describe, expect, it } from "vitest";
import { parseNow } from "@/lib/now";

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

  it("keeps a valid bake", () => {
    const r = parseNow({ bake: { name: "Sourdough", photo: "/misc/a.webp", bakedAt: "2026-11-01T10:00:00Z" } });
    expect(r.bake).toEqual({ name: "Sourdough", photo: "/misc/a.webp", bakedAt: "2026-11-01T10:00:00Z" });
  });
});
