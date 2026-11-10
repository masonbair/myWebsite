import { Webhook } from "svix";
import { readCappedBody } from "@/lib/hub/capped-body";
import { alignedDkimFrom, type DnsResolve } from "./dkim";
import { ingestEmail, type IngestDeps } from "./ingest";

export type InboundDeps = {
  secret: string | undefined;
  apiKey: string | undefined;
  /** Comma-separated Gmail addresses that forward newsletters in. */
  forwardFrom: string | undefined;
  fetchFn: typeof fetch;
  dnsResolve: DnsResolve;
  /** null when the database env is missing. */
  ingest: IngestDeps | null;
};

const MAX_EVENT_BYTES = 256 * 1024;
const MAX_RAW_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
// Resend serves raw mail from a signed CloudFront URL; anything else is refused so a bad API answer cannot aim the fetch elsewhere.
const RAW_HOST_SUFFIXES = [".resend.com", ".resend.app", ".cloudfront.net"];

type Retrieved = {
  raw?: { download_url?: string } | null;
  headers?: Record<string, unknown> | null;
  received_for?: unknown;
  authentication?: { dkim?: string } | null;
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

function parseForwarders(list: string | undefined): string[] {
  return (list ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
}

function forwardedTo(retrieved: Retrieved, forwarders: string[]): boolean {
  const want = new Set(forwarders);
  const header = Object.entries(retrieved.headers ?? {}).find(([k]) => k.toLowerCase() === "x-forwarded-for")?.[1];
  const values = [header, ...(Array.isArray(retrieved.received_for) ? retrieved.received_for : [])];
  return values.some((v) => typeof v === "string" && v.split(/[\s<>,;"]+/).some((token) => want.has(token.toLowerCase())));
}

function allowedRawHost(url: URL): boolean {
  return url.protocol === "https:" && RAW_HOST_SUFFIXES.some((suffix) => url.hostname.toLowerCase().endsWith(suffix));
}

/** Verifies a Resend `email.received` webhook, fetches the raw email and ingests it; Resend retries on 502. */
export async function handleInbound(request: Request, deps: InboundDeps): Promise<Response> {
  const { secret, apiKey, ingest } = deps;
  const forwarders = parseForwarders(deps.forwardFrom);
  if (!secret || !apiKey || forwarders.length === 0 || !ingest) return json({ error: "not configured" }, 503);

  const bytes = await readCappedBody(request, MAX_EVENT_BYTES);
  if (!bytes) return json({ error: "too large" }, 413);
  const body = new TextDecoder().decode(bytes);

  try {
    new Webhook(secret).verify(body, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    });
  } catch {
    return json({ error: "bad signature" }, 401);
  }
  let event: { type?: unknown; data?: { email_id?: unknown; id?: unknown } } | null;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!event || typeof event !== "object") return json({ error: "bad json" }, 400);

  if (event.type !== "email.received") return json({ status: "ignored" });
  const emailId = [event.data?.email_id, event.data?.id].find((v): v is string => typeof v === "string" && v.length > 0);
  if (!emailId) return json({ error: "no email id" }, 400);

  try {
    const res = await deps.fetchFn(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("news inbound: resend retrieve failed", { emailId, status: res.status });
      return json({ error: "resend unavailable" }, 502);
    }
    const retrieved = (await res.json()) as Retrieved;

    let downloadUrl: URL | null = null;
    try {
      downloadUrl = retrieved.raw?.download_url ? new URL(retrieved.raw.download_url) : null;
    } catch {
      downloadUrl = null;
    }
    if (!downloadUrl) {
      console.error("news inbound: raw email not downloadable", { emailId });
      return json({ error: "raw email unavailable" }, 502);
    }
    if (!allowedRawHost(downloadUrl)) {
      console.error("news inbound: raw email host refused", { emailId, protocol: downloadUrl.protocol, host: downloadUrl.hostname });
      return json({ error: "raw email unavailable" }, 502);
    }

    const download = await deps.fetchFn(downloadUrl.href, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!download.ok) {
      console.error("news inbound: raw download failed", { emailId, status: download.status });
      return json({ error: "raw email unavailable" }, 502);
    }
    const raw = await readCappedBody(download, MAX_RAW_BYTES);
    if (!raw) {
      console.error("news inbound: raw email too large", { emailId });
      return json({ error: "raw email too large" }, 502);
    }

    const dkimFrom = await alignedDkimFrom(raw, deps.dnsResolve);
    const result = await ingestEmail(raw, ingest, { kind: "webhook", forwardedOk: forwardedTo(retrieved, forwarders), dkimFrom });
    console.info("news inbound", {
      emailId,
      status: result.status,
      issueStatus: result.issueStatus,
      alignedDkim: dkimFrom !== null,
      resendDkim: typeof retrieved.authentication?.dkim === "string" ? retrieved.authentication.dkim.slice(0, 20) : null,
    });
    return json({ status: result.status });
  } catch (error) {
    console.error("news inbound: failed", { emailId, error: error instanceof Error ? error.name : "unknown" });
    return json({ error: "failed" }, 502);
  }
}
