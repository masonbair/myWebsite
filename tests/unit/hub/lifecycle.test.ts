import { describe, expect, it } from "vitest";
import { blockLabels, claimLabels, finishLabels, isClaimable, labelsForStatus } from "@/lib/hub/lifecycle";
import type { Item } from "@/lib/hub/types";

const now = new Date("2026-10-23T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const item = (labels: string[], updatedAt = minutesAgo(1), state: Item["state"] = "open") => ({ labels, updatedAt, state });

describe("isClaimable", () => {
  it.each([
    [["claude"], true],
    [["claude", "claude-done"], true],
    [["claude", "claude-question"], true],
    [["todo"], false],
  ])("%j → %s", (labels, expected) => {
    expect(isClaimable(item(labels), now)).toBe(expected);
  });

  it("is false for an item taken 30 min ago", () => {
    expect(isClaimable(item(["claude", "claude-working"], minutesAgo(30)), now)).toBe(false);
  });

  it("is true for an item taken over 2h ago", () => {
    expect(isClaimable(item(["claude", "claude-working"], minutesAgo(121)), now)).toBe(true);
  });

  it("is false for an item that is not open", () => {
    expect(isClaimable(item(["claude"], minutesAgo(1), "done"), now)).toBe(false);
    expect(isClaimable(item(["claude"], minutesAgo(1), "archived"), now)).toBe(false);
  });
});

describe("label transitions", () => {
  it("claim drops old status labels and adds claude-working", () => {
    expect(claimLabels(["claude", "claude-done", "idea"])).toEqual(["idea", "claude", "claude-working"]);
    expect(claimLabels(["claude-question", "claude", "todo"])).toEqual(["todo", "claude", "claude-working"]);
  });

  it("finish leaves only claude-done as status", () => {
    expect(finishLabels(["idea", "claude", "claude-working"])).toEqual(["idea", "claude-done"]);
  });

  it("block leaves only claude-question as status", () => {
    expect(blockLabels(["idea", "claude", "claude-working"])).toEqual(["idea", "claude-question"]);
  });

  it("never adds claude when it was absent", () => {
    for (const fn of [claimLabels, finishLabels, blockLabels]) {
      expect(fn(["idea", "claude-working"])).not.toContain("claude");
    }
  });

  it("picks the transition for each status label", () => {
    expect(labelsForStatus("claude-working", ["claude"])).toEqual(["claude", "claude-working"]);
    expect(labelsForStatus("claude-done", ["claude", "claude-working"])).toEqual(["claude-done"]);
    expect(labelsForStatus("claude-question", ["claude", "claude-working"])).toEqual(["claude-question"]);
  });
});
