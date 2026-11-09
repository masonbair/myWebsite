import { Webhook } from "svix";
import { readCappedBody } from "@/lib/hub/capped-body";
import { ingestEmail, type IngestDeps } from "./ingest";

export type InboundDeps = {
  secret: string | undefined;
  apiKey: string | undefined;
  forwardFrom: string | undefined;
  fetchFn: typeof fetch;
  ingest: IngestDeps;
};

const MAX_EVENT_BYTES = 256 * 1024;
const MAX_RAW_BYTES = 10 * 1024 * 1024;

type Retrieved = {
  raw?: { download_url?: string } | null;
  headers?: Record<string, unknown> | null;
  received_for?: unknown;
  authentication?: { dkim?: string } | null;
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

function forwardedTo(retrieved: Retrieved, forwardFrom: string): boolean {
  const want = forwardFrom.trim().toLowerCase();
  const header = Object.entries(retrieved.headers ?? {}).find(([k]) => k.toLowerCase() === "x-forwarded-for")?.[1];
  const addresses = [
    ...(typeof header === "string" ? header.split(/[\s,;]+/) : []),
    ...(Array.isArray(retrieved.received_for) ? retrieved.received_for : []),
  ];
  return addresses.some((a) => typeof a === "string" && a.trim().toLowerCase() === want);
}

/** Verifies a Resend `email.received` webhook, fetches the raw email and ingests it; Resend retries on 502. */
export async function handleInbound(request: Request, deps: InboundDeps): Promise<Response> {
  const { secret, apiKey, forwardFrom } = deps;
  if (!secret || !apiKey || !forwardFrom) return json({ error: "not configured" }, 503);

  const bytes = await readCappedBody(request, MAX_EVENT_BYTES);
  if (!bytes) return json({ error: "too large" }, 413);
  const body = new TextDecoder().decode(bytes);

  let event: { type?: unknown; data?: { email_id?: unknown; id?: unknown } };
  try {
    new Webhook(secret).verify(body, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    });
    event = JSON.parse(body);
  } catch {
    return json({ error: "bad signature" }, 401);
  }

  if (event.type !== "email.received") return json({ status: "ignored" });
  const emailId = [event.data?.email_id, event.data?.id].find((v): v is string => typeof v === "string" && v.length > 0);
  if (!emailId) return json({ error: "no email id" }, 400);

  try {
    const res = await deps.fetchFn(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
    if (!downloadUrl || downloadUrl.protocol !== "https:") {
      console.error("news inbound: raw email not downloadable", { emailId });
      return json({ error: "raw email unavailable" }, 502);
    }

    const download = await deps.fetchFn(downloadUrl.href);
    if (!download.ok) {
      console.error("news inbound: raw download failed", { emailId, status: download.status });
      return json({ error: "raw email unavailable" }, 502);
    }
    const raw = await readCappedBody(download, MAX_RAW_BYTES);
    if (!raw) {
      console.error("news inbound: raw email too large", { emailId });
      return json({ error: "raw email too large" }, 502);
    }

    const result = await ingestEmail(raw, deps.ingest, {
      kind: "webhook",
      forwardedOk: forwardedTo(retrieved, forwardFrom),
      dkimPass: retrieved.authentication?.dkim === "pass",
    });
    console.info("news inbound", { emailId, status: result.status, issueStatus: result.issueStatus });
    return json({ status: result.status });
  } catch (error) {
    console.error("news inbound: failed", { emailId, error: error instanceof Error ? error.name : "unknown" });
    return json({ error: "failed" }, 502);
  }
}
