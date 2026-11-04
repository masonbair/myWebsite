import type { NextConfig } from "next";

// Both env vars are set only by playwright.config.ts, to run one dev server per now.json fixture.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG || "tsconfig.json" },
  // AVIF about halves the photos (phone hero 91 KB to 49 KB); WebP stays as the fallback.
  images: { formats: ["image/avif", "image/webp"] },
};

export default nextConfig;
