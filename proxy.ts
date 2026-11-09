import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { loginHref } from "@/lib/auth/safe-next";

// Chrome fetches the manifest and its icons without cookies, so they must load signed out for install to work.
const PUBLIC_HUB_PATHS = new Set([
  "/hub/login",
  "/hub/auth/callback",
  "/hub/manifest.webmanifest",
  "/hub/icon-192.png",
  "/hub/icon-512.png",
  "/hub/icon-maskable-512.png",
  // The browser refetches the worker script to update it, and a redirect to login would fail that update.
  "/hub/sw.js",
]);
const MACHINE_API = /^\/api\/hub\/(worker|events)(\/|$)/;

function noindex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

// Cheap pre-check only: each worker or events route still verifies its own token.
function gateMachineApi(request: NextRequest): NextResponse {
  if (!/^Bearer \S+/.test(request.headers.get("authorization") ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

// Optimistic check that also refreshes the session cookie; requireOwner() or checkOwner() is the real gate.
async function readSession(request: NextRequest): Promise<{ response: NextResponse; signedIn: boolean }> {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { response, signedIn: false };
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  return { response, signedIn: !error && Boolean(data?.claims?.sub) };
}

// Carry over cookies @supabase/ssr cleared for a dead session, or the browser keeps resending them.
function withCookies<T extends NextResponse>(target: T, from: NextResponse): T {
  for (const cookie of from.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

async function gateBrowserApi(request: NextRequest): Promise<NextResponse> {
  const { response, signedIn } = await readSession(request);
  if (signedIn) return response;
  return withCookies(NextResponse.json({ error: "unauthorized" }, { status: 401 }), response);
}

async function gateHubPage(request: NextRequest): Promise<NextResponse> {
  const { response, signedIn } = await readSession(request);
  if (PUBLIC_HUB_PATHS.has(request.nextUrl.pathname) || signedIn) return response;
  // 303 so a signed-out share POST becomes a GET of the login page instead of a POST to it.
  const isRead = request.method === "GET" || request.method === "HEAD";
  const status = isRead ? 307 : 303;
  // Only a page view asks to come back; a share POST has nothing to return to.
  const login = loginHref(isRead ? request.nextUrl.pathname : null);
  return withCookies(NextResponse.redirect(new URL(login, request.url), status), response);
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (MACHINE_API.test(path)) return gateMachineApi(request);
  if (/^\/api\/hub(\/|$)/.test(path)) return gateBrowserApi(request);
  return noindex(await gateHubPage(request));
}

export const config = {
  matcher: ["/hub/:path*", "/api/hub/:path*"],
};
