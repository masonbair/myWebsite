import { NextResponse, type NextRequest } from "next/server";
import { isOwnerUser } from "@/lib/auth/owner";
import { recordOwner } from "@/lib/auth/require-owner";
import { clearedReturnCookie, RETURN_COOKIE } from "@/lib/auth/return-cookie";
import { safeHubPath } from "@/lib/auth/safe-next";
import { serviceClient, sessionClient } from "@/lib/supabase/server";

// The return cookie is single use, so every answer from here clears it.
function redirectTo(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.set(RETURN_COOKIE, "", clearedReturnCookie);
  return response;
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const next = safeHubPath(request.cookies.get(RETURN_COOKIE)?.value);
  const retry = new URL("/hub/login?error=1", origin);
  if (next !== "/hub") retry.searchParams.set("next", next);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirectTo(retry);

  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return redirectTo(retry);

  // Strangers still get a session but never a hub_owner row, so requireOwner and RLS give them nothing.
  if (isOwnerUser(data.user)) {
    try {
      await recordOwner(serviceClient(), data.user.id);
    } catch {
      return redirectTo(retry);
    }
  }
  return redirectTo(new URL(next, origin));
}
