import { NextResponse, type NextRequest } from "next/server";
import { isOwnerUser } from "@/lib/auth/owner";
import { recordOwner } from "@/lib/auth/require-owner";
import { serviceClient, sessionClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const failed = NextResponse.redirect(new URL("/hub/login?error=1", origin));
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return failed;

  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return failed;

  // Strangers still get a session but never a hub_owner row, so requireOwner and RLS give them nothing.
  if (isOwnerUser(data.user)) {
    try {
      await recordOwner(serviceClient(), data.user.id);
    } catch {
      return failed;
    }
  }
  return NextResponse.redirect(new URL("/hub", origin));
}
