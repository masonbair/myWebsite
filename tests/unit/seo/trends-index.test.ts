import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTrends } from "@/lib/news/public";

const data: { trends: PublicTrends | null } = { trends: null };
vi.mock("@/lib/news/public", async (load) => ({
  ...(await load<typeof import("@/lib/news/public")>()),
  readPublicTrends: async () => data.trends,
}));

const row = (day: string) => ({ day, kind: "topic" as const, key: "ai", label: "AI", ticker: null, stories: 1, mentions: 1, toneAvg: 0, sources: [] });

describe("/trends search visibility", () => {
  beforeEach(() => {
    data.trends = null;
  });

  it("is hidden from search and the sitemap while there is no data", async () => {
    const { generateMetadata } = await import("@/app/trends/page");
    const { default: sitemap } = await import("@/app/sitemap");
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
    expect((await sitemap()).map((e) => e.url)).not.toContain("https://masonbair.com/trends");
  });

  it("is indexed and dated by its newest row once data exists", async () => {
    data.trends = { today: "2026-12-20", rows: [row("2026-12-18"), row("2026-12-19")] };
    const { generateMetadata } = await import("@/app/trends/page");
    const { default: sitemap } = await import("@/app/sitemap");
    expect((await generateMetadata()).robots).toBeUndefined();
    const entry = (await sitemap()).find((e) => e.url === "https://masonbair.com/trends");
    expect(entry?.lastModified).toEqual(new Date("2026-12-19"));
  });
});
