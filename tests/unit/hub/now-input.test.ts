import { describe, expect, it } from "vitest";
import { MAX_BAKE_NAME, NowInputError, parseBakeInput } from "@/lib/hub/now-input";

const now = new Date("2026-11-05T12:00:00Z");

describe("parseBakeInput", () => {
  it("defaults the time to now and the photo to none", () => {
    expect(parseBakeInput({ name: "  Sourdough ", photo: "", bakedAt: "" }, now)).toEqual({
      name: "Sourdough",
      photo: null,
      bakedAt: "2026-11-05T12:00:00.000Z",
    });
  });

  it("keeps a /misc photo and an earlier time", () => {
    expect(parseBakeInput({ name: "Babka", photo: "/misc/babka.webp", bakedAt: "2026-11-04T18:30:00.000Z" }, now)).toEqual({
      name: "Babka",
      photo: "/misc/babka.webp",
      bakedAt: "2026-11-04T18:30:00.000Z",
    });
  });

  it.each([
    [{ name: "" }, "needs a name"],
    [{ name: "   " }, "needs a name"],
    [{ name: 5 }, "needs a name"],
    [{ name: "x".repeat(MAX_BAKE_NAME + 1) }, "under"],
    [{ name: "Rye", photo: "https://example.com/x.webp" }, "/misc"],
    [{ name: "Rye", photo: "/misc/../.env" }, "/misc"],
    [{ name: "Rye", photo: "/misc/x.gif" }, "/misc"],
    [{ name: "Rye", bakedAt: "yesterday-ish" }, "not a real date"],
    [{ name: "Rye", bakedAt: "1999-12-31T00:00:00Z" }, "not a real date"],
    [{ name: "Rye", bakedAt: "2026-11-06T12:00:00Z" }, "future"],
  ])("refuses %j", (raw, message) => {
    expect(() => parseBakeInput(raw, now)).toThrow(NowInputError);
    expect(() => parseBakeInput(raw, now)).toThrow(message);
  });
});
