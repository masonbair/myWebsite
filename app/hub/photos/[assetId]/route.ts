import type { NextRequest } from "next/server";
import { checkOwner } from "@/lib/auth/require-owner";
import { servePhoto, supabasePhotoStore } from "@/lib/photo-server";
import { serviceClient } from "@/lib/supabase/server";

/** The hub's thumbnails, hidden photos included, so Mason can see what he is showing again. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  const owner = await checkOwner();
  if (!owner.ok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const { assetId } = await ctx.params;
  return servePhoto(assetId, request.nextUrl.searchParams.get("w"), {
    store: () => supabasePhotoStore(serviceClient()),
    includeHidden: true,
    cacheControl: "private, max-age=300",
  });
}
