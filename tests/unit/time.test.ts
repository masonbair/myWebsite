import { describe, expect, it } from "vitest";
import { timeAgo } from "@/lib/time";

const now = new Date("2026-11-04T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const S = 1000, H = 3600 * S, D = 24 * H;

describe("timeAgo", () => {
  it("handles each bucket", () => {
    expect(timeAgo(ago(30 * S), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60 * S), now)).toBe("5 minutes ago");
    expect(timeAgo(ago(3 * H), now)).toBe("3 hours ago");
    expect(timeAgo(ago(1 * D), now)).toBe("1 day ago");
    expect(timeAgo(ago(36 * D), now)).toBe("5 weeks ago");
    expect(timeAgo(ago(90 * D), now)).toBe("3 months ago");
    expect(timeAgo(ago(800 * D), now)).toBe("2 years ago");
  });

  it("never renders 12 months", () => {
    expect(timeAgo(ago(362 * D), now)).toBe("11 months ago");
    expect(timeAgo(ago(365 * D), now)).toBe("1 year ago");
  });

  it("uses singular forms", () => {
    expect(timeAgo(ago(1 * H), now)).toBe("1 hour ago");
    expect(timeAgo(ago(7 * D), now)).toBe("1 week ago");
    expect(timeAgo(ago(60 * S), now)).toBe("1 minute ago");
  });

  it("treats future and invalid dates as just now", () => {
    expect(timeAgo(new Date(now.getTime() + H).toISOString(), now)).toBe("just now");
    expect(timeAgo("garbage", now)).toBe("just now");
  });
});
