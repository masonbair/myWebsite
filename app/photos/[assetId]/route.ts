import type { NextRequest } from "next/server";
import { servePhoto, supabasePhotoStore } from "@/lib/photo-server";
import { serviceClient } from "@/lib/supabase/server";

// Short, so a photo hidden in the hub drops off the CDN within five minutes.
const CACHE = "public, max-age=300, s-maxage=300";

export async function GET(request: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  return servePhoto(assetId, request.nextUrl.searchParams.get("w"), {
    store: () => supabasePhotoStore(serviceClient()),
    includeHidden: false,
    cacheControl: CACHE,
  });
}
