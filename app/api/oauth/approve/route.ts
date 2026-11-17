import { NextResponse, type NextRequest } from "next/server";
import { checkOwner } from "@/lib/auth/require-owner";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { callbackUrl, issueCode, REQUEST_COOKIE, requestFromCookie } from "@/lib/hub/oauth";
import { supabaseGrantStore } from "@/lib/hub/oauth-store";
import { serviceClient } from "@/lib/supabase/server";

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function POST(request: NextRequest) {
  if (!request.headers.has("origin") || !isSameOriginRequest(request)) return refuse("Cross-site request refused.", 403);
  const owner = await checkOwner();
  if (!owner.ok) return refuse("Only Mason can connect Claude to the hub.", 403);
  const origin = request.nextUrl.origin;
  const pending = requestFromCookie(request.cookies.get(REQUEST_COOKIE)?.value, origin);
  if (!pending) return refuse("This sign-in link expired. Start again from Claude.", 400);
  const form = await request.formData();
  const result = form.get("decision") === "allow"
    ? { code: await issueCode(supabaseGrantStore(serviceClient()), pending, new Date()) }
    : { error: "access_denied" };
  const response = NextResponse.redirect(callbackUrl(pending, origin, result), 303);
  response.cookies.set(REQUEST_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
