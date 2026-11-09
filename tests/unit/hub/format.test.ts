import { describe, expect, it } from "vitest";
import { formatDue, isItemId, listHref, needsYouReason } from "@/lib/hub/format";

describe("hub format", () => {
  it("prints a due date without shifting the day", () => {
    expect(formatDue({ date: "2026-11-20", time: null })).toBe("Due Fri, Nov 20");
    expect(formatDue({ date: "2026-11-20", time: "09:30:00" })).toBe("Due Fri, Nov 20, 9:30 AM");
    expect(formatDue(null)).toBeNull();
  });

  it("accepts only uuids as item ids", () => {
    expect(isItemId("6f1c2a52-6a39-4c55-9a2e-1b2a3c4d5e6f")).toBe(true);
    expect(isItemId("not-a-uuid")).toBe(false);
    expect(isItemId(42)).toBe(false);
  });

  it("links the inbox to /hub and other lists to their page", () => {
    expect(listHref("inbox")).toBe("/hub");
    expect(listHref("ideas")).toBe("/hub/ideas");
  });

  it("names why an item needs Mason, question first", () => {
    expect(needsYouReason(["claude", "claude-done", "claude-question"])).toBe("Claude has a question");
    expect(needsYouReason(["claude-done"])).toBe("Claude finished, check the result");
    expect(needsYouReason(["laptop"])).toBeNull();
  });
});
