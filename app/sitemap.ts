import type { MetadataRoute } from "next";
import { siteUpdated, siteUrl } from "@/content/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(siteUpdated);
  return [
    { url: siteUrl, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/coffee`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/trends`, changeFrequency: "daily", priority: 0.6 },
  ];
}
