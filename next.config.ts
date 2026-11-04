import type { NextConfig } from "next";

// Both env vars are set only by playwright.config.ts, to run one dev server per now.json fixture.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG || "tsconfig.json" },
  // Mirrors vercel.json so /coffee also works under `next start`.
  async redirects() {
    return [{ source: "/coffee", destination: "https://calendar.app.google/suAxGdTVkbEB2GFN6", permanent: false }];
  },
};

export default nextConfig;
