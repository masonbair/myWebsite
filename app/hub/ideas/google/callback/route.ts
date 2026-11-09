import { NextResponse, type NextRequest } from "next/server";
import { checkOwner } from "@/lib/auth/require-owner";
import {
  CALLBACK_PATH,
  claimState,
  clearedStateCookie,
  connectGoogle,
  googleConfig,
  sameState,
  SETTINGS_PATH,
  STATE_COOKIE,
} from "@/lib/ideas/google";
import { serviceClient } from "@/lib/supabase/server";

function toSettings(request: NextRequest, outcome: string): NextResponse {
  return NextResponse.redirect(new URL(`${SETTINGS_PATH}?google=${outcome}`, request.url), 303);
}

function badRequest(): NextResponse {
  return new NextResponse("This Google sign-in link is not valid or has expired. Go back to Ideas Lab settings and connect again.", {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Google sends the owner back here after the consent screen. */
export async function GET(request: NextRequest) {
  const owner = await checkOwner();
  if (!owner.ok && owner.reason === "signed-out") return NextResponse.redirect(new URL("/hub/login", request.url), 303);
  if (!owner.ok) return new NextResponse("Not found", { status: 404 });

  const presented = request.nextUrl.searchParams.get("state");
  // The state is single use: cleared before anything else, whatever the outcome.
  const claimed = await claimState(serviceClient(), presented, new Date());
  const res = await finish(request, claimed && sameState(presented, request.cookies.get(STATE_COOKIE)?.value));
  res.cookies.set(STATE_COOKIE, "", clearedStateCookie);
  return res;
}

async function finish(request: NextRequest, stateOk: boolean): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return toSettings(request, "denied");
  if (!stateOk) return badRequest();
  const code = params.get("code");
  if (!code) return badRequest();
  const config = googleConfig();
  if (!config) return toSettings(request, "not-configured");

  try {
    const outcome = await connectGoogle(serviceClient(), {
      code,
      redirectUri: `${request.nextUrl.origin}${CALLBACK_PATH}`,
      config,
      fetchFn: (input, init) => fetch(input, init),
    });
    return toSettings(request, outcome === "connected" ? "connected" : "no-lasting-token");
  } catch (error) {
    // Only our own error text: GoogleError carries a status and Google's short code, never a token or the code.
    console.error("ideas google connect failed:", error instanceof Error ? error.message : "unknown error");
    return toSettings(request, "failed");
  }
}
