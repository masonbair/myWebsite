import type { NextRequest } from "next/server";
import { readCappedBody } from "@/lib/hub/capped-body";
import { exchange, OAuthError } from "@/lib/hub/oauth";
import { supabaseGrantStore } from "@/lib/hub/oauth-store";
import { serviceClient } from "@/lib/supabase/server";

const MAX_FORM_BYTES = 8 * 1024;
const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(request: NextRequest) {
  const bytes = await readCappedBody(request, MAX_FORM_BYTES);
  if (!bytes) return Response.json({ error: "invalid_request" }, { status: 413, headers: noStore });
  try {
    const tokens = await exchange(supabaseGrantStore(serviceClient()), new URLSearchParams(new TextDecoder().decode(bytes)), request.nextUrl.origin, new Date());
    return Response.json(tokens, { headers: noStore });
  } catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    return Response.json({ error: e.code, error_description: e.message }, { status: e.status, headers: noStore });
  }
}
