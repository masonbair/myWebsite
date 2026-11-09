import type { MetadataRoute } from "next";
import { coffeeUpdated } from "@/content/coffee";
import { siteUpdated, siteUrl } from "@/content/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, lastModified: new Date(siteUpdated), changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/coffee`, lastModified: new Date(coffeeUpdated), changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/trends`, changeFrequency: "daily", priority: 0.6 },
  ];
}
