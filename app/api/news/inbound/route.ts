import { Resolver } from "node:dns/promises";
import { put } from "@vercel/blob";
import { createIngestDeps } from "@/lib/news/ingest-store";
import { handleInbound } from "@/lib/news/resend";
import { serviceClient } from "@/lib/supabase/server";

const dns = new Resolver({ timeout: 3000, tries: 2 });

// Outside /api/hub, so proxy.ts does not gate it; the svix signature check is the only gate.
export async function POST(request: Request) {
  const dbReady = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return handleInbound(request, {
    secret: process.env.RESEND_INBOUND_SECRET,
    apiKey: process.env.RESEND_API_KEY,
    forwardFrom: process.env.NEWS_FORWARD_FROM,
    fetchFn: fetch,
    dnsResolve: async (name, rrtype) => {
      if (rrtype !== "TXT") throw new Error(`unexpected DNS type ${rrtype}`);
      return dns.resolveTxt(name);
    },
    ingest: dbReady
      ? createIngestDeps(
          serviceClient(),
          async (path, raw) => {
            await put(path, Buffer.from(raw), { access: "private", addRandomSuffix: false, allowOverwrite: true });
          },
          process.env.HUB_TIME_ZONE || "America/New_York",
        )
      : null,
  });
}
