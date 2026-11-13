import type { MetadataRoute } from "next";
import { coffeeUpdated } from "@/content/coffee";
import { siteUpdated, siteUrl } from "@/content/site";
import { hasTrendData, readPublicTrends } from "@/lib/news/public";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: new Date(siteUpdated), changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/coffee`, lastModified: new Date(coffeeUpdated), changeFrequency: "monthly", priority: 0.8 },
  ];
  const trends = await readPublicTrends();
  // /trends is left out while it has nothing to show, matching its noindex tag.
  if (hasTrendData(trends)) {
    const latest = trends.rows[trends.rows.length - 1].day;
    pages.push({ url: `${siteUrl}/trends`, lastModified: new Date(latest), changeFrequency: "daily", priority: 0.6 });
  }
  return pages;
}
