import { describe, expect, it } from "vitest";
import { captureFromShare, parseCapture, splitCapture } from "@/lib/hub/capture";

const KEY = "3f2a8c1e-5b7d-4e9a-8c6f-1a2b3c4d5e6f";

describe("parseCapture", () => {
  it("trims the title and keeps the description and key", () => {
    expect(parseCapture({ title: "  Buy flour ", description: "the good one", clientKey: KEY })).toEqual({
      title: "Buy flour",
      description: "the good one",
      clientKey: KEY,
      asIdea: false,
    });
  });

  it("keeps asIdea when it is true", () => {
    expect(parseCapture({ title: "x", clientKey: KEY, asIdea: true }).asIdea).toBe(true);
  });

  it("allows a missing description", () => {
    expect(parseCapture({ title: "x", clientKey: KEY })).toEqual({ title: "x", description: "", clientKey: KEY, asIdea: false });
  });

  it.each([
    ["no object", null],
    ["blank title", { title: "  ", clientKey: KEY }],
    ["title too long", { title: "a".repeat(501), clientKey: KEY }],
    ["description too long", { title: "x", description: "a".repeat(10_001), clientKey: KEY }],
    ["description not text", { title: "x", description: 5, clientKey: KEY }],
    ["missing key", { title: "x" }],
    ["asIdea not a boolean", { title: "x", clientKey: KEY, asIdea: "yes" }],
    ["key not a uuid", { title: "x", clientKey: "abc" }],
  ])("refuses %s", (_name, raw) => {
    expect(() => parseCapture(raw)).toThrow(/bad capture/);
  });
});

describe("splitCapture", () => {
  it("uses the first line as the title and the rest as the description", () => {
    expect(splitCapture("Call the bakery\nask about rye\n")).toEqual({
      title: "Call the bakery",
      description: "ask about rye",
    });
  });

  it("keeps the whole text in the description when the first line is too long for a title", () => {
    const long = "word ".repeat(150).trim();
    const split = splitCapture(long);
    expect(split.title.length).toBeLessThanOrEqual(500);
    expect(split.title.endsWith("...")).toBe(true);
    expect(split.description).toBe(long);
  });

  it("returns an empty title for blank text", () => {
    expect(splitCapture(" \n ").title).toBe("");
  });
});

describe("captureFromShare", () => {
  it("puts the shared url in the description and uses the shared title", () => {
    expect(captureFromShare({ title: "A recipe", text: "Look at this", url: "https://example.com/rye" })).toEqual({
      title: "A recipe",
      description: "Look at this\n\nhttps://example.com/rye",
    });
  });

  it("falls back to the text, then the url, for the title", () => {
    expect(captureFromShare({ text: "Rye bread https://example.com/rye" }).title).toBe("Rye bread https://example.com/rye");
    expect(captureFromShare({ url: "https://example.com/rye" })).toEqual({
      title: "https://example.com/rye",
      description: "https://example.com/rye",
    });
  });

  it("does not repeat a url the text already holds", () => {
    expect(captureFromShare({ text: "see https://example.com/rye", url: "https://example.com/rye" }).description).toBe(
      "see https://example.com/rye",
    );
  });

  it("returns an empty title when nothing was shared", () => {
    expect(captureFromShare({}).title).toBe("");
  });
});
