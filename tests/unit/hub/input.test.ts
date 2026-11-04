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

  it("clears a due date with null", () => {
    expect(parseItemPatch({ due: null })).toEqual({ due: null });
  });

  it.each([
    [null],
    [{ list: "someday" }],
    [{ labels: "laptop" }],
    [{ labels: [""] }],
    [{ title: "   " }],
    [{ due: { date: "20 Nov" } }],
    [{ due: { date: "2026-11-20", time: "9am" } }],
  ])("refuses %j", (raw) => {
    expect(() => parseItemPatch(raw)).toThrow(/bad item patch/);
  });
});
