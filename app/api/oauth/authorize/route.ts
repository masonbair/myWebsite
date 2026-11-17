import { NextResponse, type NextRequest } from "next/server";
import { isLocalHost } from "@/lib/auth/return-cookie";
import { callbackUrl, checkAuthorize, OAuthError, REQUEST_COOKIE } from "@/lib/hub/oauth";

const TEN_MINUTES = 600;

// The request waits in a cookie, so it survives the GitHub sign-in round trip, which only keeps a plain hub path.
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  let checked;
  try {
    checked = checkAuthorize(request.nextUrl.searchParams, origin);
  } catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    return new Response(`Hub sign-in refused: ${e.message}.`, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if ("redirectError" in checked) {
    return NextResponse.redirect(callbackUrl(checked, origin, { error: checked.redirectError }), 303);
  }
  const response = NextResponse.redirect(new URL("/hub/connect", origin), 303);
  response.cookies.set(REQUEST_COOKIE, JSON.stringify(checked), {
    httpOnly: true,
    secure: !isLocalHost(request.headers.get("host") ?? ""),
    sameSite: "lax",
    path: "/",
    maxAge: TEN_MINUTES,
  });
  return response;
}
