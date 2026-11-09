import { describe, expect, it } from "vitest";
import { formatLocation } from "@/lib/location";

const base = { updatedAt: "2026-11-01T00:00:00Z" };

describe("formatLocation", () => {
  it("shows city and country", () => {
    expect(formatLocation({ ...base, city: "Lisbon", region: "Lisbon", country: "Portugal", private: false })).toBe("Lisbon, Portugal");
  });

  it("hides city when private", () => {
    const out = formatLocation({ ...base, city: "Kent", region: "Ohio", country: "United States", private: true });
    expect(out).toBe("Ohio, United States");
    expect(out).not.toContain("Kent");
  });

  it("falls back to country when private and region is empty", () => {
    expect(formatLocation({ ...base, city: "Kent", region: "", country: "United States", private: true })).toBe("United States");
  });

  it("shows region and country for a private place with no city", () => {
    expect(formatLocation({ ...base, city: null, region: "Ohio", country: "United States", private: true })).toBe("Ohio, United States");
  });

  it("never prints a missing city on a public place", () => {
    expect(formatLocation({ ...base, city: null, region: "Ohio", country: "United States", private: false })).toBe("Ohio, United States");
  });
});
