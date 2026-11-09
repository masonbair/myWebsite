import { NextResponse, type NextRequest } from "next/server";
import { checkOwner } from "@/lib/auth/require-owner";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import {
  authUrl,
  CALLBACK_PATH,
  googleConfig,
  newState,
  saveState,
  SETTINGS_PATH,
  STATE_COOKIE,
  stateCookieOptions,
} from "@/lib/ideas/google";
import { serviceClient } from "@/lib/supabase/server";

/** The settings page's Connect form posts here; a POST so link prefetching can never start a consent round. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return new NextResponse("Forbidden", { status: 403 });
  const owner = await checkOwner();
  if (!owner.ok && owner.reason === "signed-out") return NextResponse.redirect(new URL("/hub/login", request.url), 303);
  if (!owner.ok) return new NextResponse("Not found", { status: 404 });

  const config = googleConfig();
  if (!config) return NextResponse.redirect(new URL(`${SETTINGS_PATH}?google=not-configured`, request.url), 303);

  const state = newState();
  await saveState(serviceClient(), state);
  // The request's own origin, so a preview deploy works once its URI is added on the Google OAuth client.
  const redirectUri = `${request.nextUrl.origin}${CALLBACK_PATH}`;
  const res = NextResponse.redirect(authUrl(state, redirectUri, config), 303);
  res.cookies.set(STATE_COOKIE, state, stateCookieOptions(request.nextUrl.host));
  return res;
}
