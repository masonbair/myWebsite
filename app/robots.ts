import type { MetadataRoute } from "next";
import { siteUrl } from "@/content/site";

// Named so each search and AI crawler sees an explicit allow, even ones that skip the `*` group.
const crawlers = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Googlebot",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "Bingbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: crawlers, allow: "/" },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
