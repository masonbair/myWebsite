import type { NextRequest } from "next/server";
import { classifyAgent, classifySource, normalizeCountry, normalizePath } from "./classify";

export type Visit = {
  p_path: string;
  p_kind: string;
  p_agent: string;
  p_ref_host: string;
  p_from_assistant: string;
  p_country: string;
  p_ua_sample: string;
  p_visitor_hash: string | null;
};

const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Daily-rotating visitor id: the date is mixed with the secret salt, so ids cannot be linked across days. */
export async function visitorHash(salt: string, ip: string, userAgent: string, now: Date): Promise<string> {
  return sha256Hex(`${salt}|${easternDay.format(now)}|${ip}|${userAgent}`);
}

/** Mason's browser carries a Supabase session cookie; no visitor does, since the public site never signs anyone in. */
function isOwnerBrowser(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => /^sb-.+-auth-token/.test(c.name));
}

/** Prefetches and client-side navigations are not page reads. */
function isPageRead(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  const h = request.headers;
  return !h.get("rsc") && !h.get("next-router-prefetch") && h.get("purpose") !== "prefetch" && h.get("sec-purpose") !== "prefetch";
}

/** Builds the analytics row for a request, or null when it should not be counted. */
export async function visitFor(request: NextRequest, salt: string | undefined, now = new Date()): Promise<Visit | null> {
  if (!isPageRead(request) || isOwnerBrowser(request)) return null;
  const ua = request.headers.get("user-agent") ?? "";
  const agent = classifyAgent(ua);
  const source = classifySource(request.headers.get("referer"), request.nextUrl, request.nextUrl.hostname);
  // x-real-ip is set by Vercel's edge and cannot be supplied by the client.
  const ip = request.headers.get("x-real-ip") ?? "";
  const hash = agent.kind === "human" && salt && ip ? await visitorHash(salt, ip, ua, now) : null;
  return {
    p_path: normalizePath(request.nextUrl.pathname),
    p_kind: agent.kind,
    p_agent: agent.name,
    p_ref_host: source.refHost,
    p_from_assistant: source.fromAssistant,
    p_country: normalizeCountry(request.headers.get("x-vercel-ip-country")),
    p_ua_sample: agent.name === "unknown" ? ua.slice(0, 120) : "",
    p_visitor_hash: hash,
  };
}

/** Sends one visit to Supabase; never throws, since a lost count must not break a page. */
export async function recordVisit(request: NextRequest): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const visit = await visitFor(request, process.env.ANALYTICS_SALT);
    if (!visit) return;
    await fetch(`${url}/rest/v1/rpc/analytics_record`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(visit),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Dropped on purpose: analytics must never affect the page.
  }
}
