import { describe, expect, it } from "vitest";
import { parseItemPatch } from "@/lib/hub/input";

describe("parseItemPatch", () => {
  it("keeps valid fields and trims and de-duplicates labels", () => {
    expect(
      parseItemPatch({ labels: [" laptop", "laptop", "claude"], list: "todo", due: { date: "2026-11-20", time: null } }),
    ).toEqual({ labels: ["laptop", "claude"], list: "todo", due: { date: "2026-11-20", time: null } });
  });

  it("drops fields it does not know, like state", () => {
    expect(parseItemPatch({ title: "Buy flour", state: "done", mergedInto: "x" })).toEqual({ title: "Buy flour" });
  });

  it("lowercases new labels and keeps labels already on the item as they are", () => {
    expect(parseItemPatch({ labels: ["Laptop", "Project X", "to-schedule:q1"] }, ["Project X"])).toEqual({
      labels: ["laptop", "Project X", "to-schedule:q1"],
    });
  });

  it("accepts a valid time and the last day of a month", () => {
    expect(parseItemPatch({ due: { date: "2028-02-29", time: "23:59" } })).toEqual({
      due: { date: "2028-02-29", time: "23:59" },
    });
  });

  it("clears a due date with null", () => {
    expect(parseItemPatch({ due: null })).toEqual({ due: null });
  });

  it.each([
    ["no object", null],
    ["unknown list", { list: "someday" }],
    ["labels not a list", { labels: "laptop" }],
    ["empty label", { labels: [""] }],
    ["blank title", { title: "   " }],
    ["date in another format", { due: { date: "20 Nov" } }],
    ["time in words", { due: { date: "2026-11-20", time: "9am" } }],
    ["a day that does not exist", { due: { date: "2026-02-31", time: null } }],
    ["hour 24", { due: { date: "2026-11-20", time: "24:00" } }],
    ["minute 60", { due: { date: "2026-11-20", time: "12:60" } }],
    ["a space in a label", { labels: ["two words"] }],
    ["an accent in a label", { labels: ["café"] }],
    ["51 labels", { labels: Array.from({ length: 51 }, (_, i) => `l${i}`) }],
    ["a description over 10,000 characters", { description: "x".repeat(10_001) }],
  ])("refuses %s", (_name, raw) => {
    expect(() => parseItemPatch(raw)).toThrow(/bad item patch/);
  });
});
