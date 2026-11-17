import { describe, expect, it } from "vitest";
import { privacyProblem, safeDescription } from "@/lib/photos/privacy";

describe("safeDescription", () => {
  it("keeps plain descriptions of Mason and unnamed people", () => {
    for (const ok of [
      "Mason smiling with a coffee at a small cafe table.",
      "Mason's selfie on a hiking trail with green hills behind him.",
      "Two friends and Mason laughing around a dinner table.",
      "A bowl of noodles with chopsticks.",
      "The ocean at sunset from a sandy beach.",
      "  Mason   in a red bucket hat.  ",
    ]) {
      expect(safeDescription(ok), ok).toBe(ok.replace(/\s+/g, " ").trim());
    }
  });

  it("drops names of places, landmarks, businesses and other people", () => {
    for (const bad of [
      "Mason in front of the Eiffel Tower.",
      "Mason walking through Lisbon at night.",
      "Mason with Sarah at a hackathon.",
      "Mason holding a Starbucks cup.",
      "Mason eating Japanese ramen.",
      "Mason at a market in mexico city.",
      "Mason on a beach in portugal.",
      "Mason in a busy town square.",
      "Mason by the river downtown.",
    ]) {
      expect(safeDescription(bad), bad).toBeNull();
    }
  });

  it("drops anything that reads out a sign or text", () => {
    for (const bad of [
      'Mason under a sign that says "welcome".',
      "Mason under a sign reading welcome home.",
      "Mason next to a banner labeled with a club logo.",
      "Mason beside a bus numbered 42.",
      "Mason in front of a cafe called the blue door.",
    ]) {
      expect(safeDescription(bad), bad).toBeNull();
    }
  });

  it("drops empty and overlong text", () => {
    expect(safeDescription("   ")).toBeNull();
    expect(privacyProblem(`Mason ${"smiling ".repeat(40)}`)).toBe("too long");
  });

  it("names the reason, for the label error column", () => {
    expect(privacyProblem("Mason in Paris.")).toBe("proper noun");
    expect(privacyProblem("Mason in 2026.")).toBe("digits");
    expect(privacyProblem("Mason in france.")).toBe("country");
    expect(privacyProblem("Mason at a cafe.")).toBeNull();
  });
});
