import type { NextConfig } from "next";

type Redirect = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

/**
 * Sends production visits on any *.vercel.app address to masonbair.com, so search engines drop the old copy.
 * @param vercelEnv the build's VERCEL_ENV; previews keep their vercel.app address for testing.
 */
export function vercelHostRedirects(vercelEnv: string | undefined): Redirect[] {
  if (vercelEnv !== "production") return [];
  return [
    {
      // API routes are skipped: webhooks and devices may still post to the old address and would not follow a redirect.
      source: "/:path((?!api/).*)",
      has: [{ type: "host", value: ".+\\.vercel\\.app" }],
      destination: "https://masonbair.com/:path",
      permanent: true,
    },
  ];
}
