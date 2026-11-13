import type { NextConfig } from "next";
import { vercelHostRedirects } from "./lib/seo/vercel-host-redirect";

// Both env vars are set only by playwright.config.ts, to run one dev server per now.json fixture.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG || "tsconfig.json" },
  // AVIF about halves the photos (phone hero 91 KB to 49 KB); WebP stays as the fallback.
  images: { formats: ["image/avif", "image/webp"] },
  // Vercel serves public/ from the CDN, not the function, so /hub/now's bake action needs /misc traced in to check a photo exists.
  outputFileTracingIncludes: { "/hub/now": ["./public/misc/*"] },
  async redirects() {
    return vercelHostRedirects(process.env.VERCEL_ENV);
  },
  async headers() {
    return [
      {
        // no-cache so a changed worker reaches phones on their next visit instead of after the HTTP cache expires.
        source: "/hub/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
