import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_HUB_PATHS = new Set(["/hub/login", "/hub/auth/callback", "/hub/manifest.webmanifest"]);

function noindex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

// Cheap pre-check only: each /api/hub route still verifies its own token.
function gateHubApi(request: NextRequest): NextResponse {
  if (!/^Bearer \S+/.test(request.headers.get("authorization") ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

// Optimistic check that also refreshes the session cookie; requireOwner() is the real gate.
async function gateHubPage(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let signedIn = false;
  if (url && anonKey) {
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
    signedIn = !error && Boolean(data?.claims?.sub);
  }
  if (PUBLIC_HUB_PATHS.has(request.nextUrl.pathname) || signedIn) return response;
  const redirect = NextResponse.redirect(new URL("/hub/login", request.url));
  // Carry over cookies @supabase/ssr cleared for a dead session, or the browser keeps resending them.
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export async function proxy(request: NextRequest) {
  if (/^\/api\/hub(\/|$)/.test(request.nextUrl.pathname)) return gateHubApi(request);
  return noindex(await gateHubPage(request));
}

export const config = {
  matcher: ["/hub/:path*", "/api/hub/:path*"],
};
