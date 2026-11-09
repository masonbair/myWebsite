import { put } from "@vercel/blob";
import { createIngestDeps } from "@/lib/news/ingest-store";
import { handleInbound } from "@/lib/news/resend";
import { serviceClient } from "@/lib/supabase/server";

// Outside /api/hub, so proxy.ts does not gate it; the svix signature check is the only gate.
export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  const forwardFrom = process.env.NEWS_FORWARD_FROM;
  return handleInbound(request, {
    secret,
    apiKey,
    forwardFrom,
    fetchFn: fetch,
    ingest: createIngestDeps(
      serviceClient(),
      async (path, raw) => {
        await put(path, Buffer.from(raw), { access: "private", addRandomSuffix: false, allowOverwrite: true });
      },
      process.env.HUB_TIME_ZONE || "America/New_York",
    ),
  });
}
