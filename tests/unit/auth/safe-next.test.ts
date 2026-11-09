import { describe, expect, it } from "vitest";
import { safeHubPath } from "@/lib/auth/safe-next";

describe("safeHubPath", () => {
  it("keeps a plain hub path", () => {
    expect(safeHubPath("/hub/ideas/0b7c6f2e-1d1a-4c55-9a51-3c1f1b2f9e10")).toBe("/hub/ideas/0b7c6f2e-1d1a-4c55-9a51-3c1f1b2f9e10");
    expect(safeHubPath("/hub/list/todo")).toBe("/hub/list/todo");
  });

  it.each([
    "//evil.com",
    "/hub//evil",
    "/hub//evil.com/x",
    "/\\evil",
    "/hub/\\evil",
    "https://evil.com",
    "https://evil.com/hub/ideas",
    "/hub/ideas?x=1",
    "/hub/ideas#x",
    "/hubx",
    "/hub",
    "hub/ideas",
    "/hub/%2F%2Fevil.com",
    "%2F%2Fevil.com",
    "/hub/../evil",
    "/hub/ideas/\nx",
    "",
    "/",
    "javascript:alert(1)",
  ])("falls back to /hub for %j", (hostile) => {
    expect(safeHubPath(hostile)).toBe("/hub");
  });

  it("falls back for values that are not one string", () => {
    expect(safeHubPath(undefined)).toBe("/hub");
    expect(safeHubPath(null)).toBe("/hub");
    expect(safeHubPath(["/hub/ideas", "//evil.com"])).toBe("/hub");
    expect(safeHubPath(42)).toBe("/hub");
  });
});
