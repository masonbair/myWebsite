import { describe, expect, it } from "vitest";
import { daylioPath } from "@/shared/collector-contract";

describe("daylioPath", () => {
  it("puts the modified time and size first, so each version of a file has its own path", () => {
    expect(daylioPath("daylio_export_2026_11_04.csv", 120, 1762000000123)).toBe("exports/1762000000123-120-daylio_export_2026_11_04.csv");
    expect(daylioPath("a.csv", 121, 1762000000123)).not.toBe(daylioPath("a.csv", 120, 1762000000123));
  });

  it("keeps the file name to a safe set of characters", () => {
    expect(daylioPath("my export (1).csv", 5, 7)).toBe("exports/7-5-my_export__1_.csv");
    expect(daylioPath("../../etc/passwd", 5, 7)).toBe("exports/7-5-._._etc_passwd");
    expect(daylioPath("", 5, 7)).toBe("exports/7-5-export");
    expect(daylioPath("x".repeat(300), 5, 7)).toHaveLength("exports/7-5-".length + 200);
  });
});
