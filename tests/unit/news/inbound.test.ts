import { readFileSync } from "node:fs";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { handleInbound, type InboundDeps } from "@/lib/news/resend";
import type { NewIssue, NewsSource } from "@/lib/news/types";

const SECRET = "whsec_" + Buffer.from("test-secret-bytes-0123456789abcd").toString("base64");
const raw = new Uint8Array(readFileSync(new URL("./fixtures/issue.eml", import.meta.url)));

const brew: NewsSource = {
  id: "brew",
  name: "Daily Brew",
  senderAddresses: [],
  senderDomains: ["example-brew.test"],
  homepage: "https://www.example-brew.test/",
  archivePattern: null,
  public: true,
  active: true,
};

type Retrieved = { raw: { download_url: string; expires_at: string } | null; headers: Record<string, string>; received_for: string[]; authentication: { dkim: string } | null };

function setup(opts: { retrieved?: Partial<Retrieved>; retrieveStatus?: number; env?: Partial<InboundDeps> } = {}) {
  const rows = new Map<string, NewIssue & { id: string }>();
  const putRaw: string[] = [];
  const calls: { url: string; auth: string | null }[] = [];
  const retrieved: Retrieved = {
    raw: { download_url: "https://files.example.test/raw/1", expires_at: "2026-11-10T00:00:00Z" },
    headers: { "X-Forwarded-For": "reader@example.test Fwd@Example.test" },
    received_for: ["news@in.masonbair.com"],
    authentication: { dkim: "pass" },
    ...opts.retrieved,
  };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url.startsWith("https://api.resend.com/emails/receiving/")) {
      return opts.retrieveStatus && opts.retrieveStatus !== 200
        ? new Response("boom", { status: opts.retrieveStatus })
        : Response.json(retrieved);
    }
    return new Response(raw);
  }) as typeof fetch;
  const deps: InboundDeps = {
    secret: SECRET,
    apiKey: "re_test",
    forwardFrom: "fwd@example.test",
    fetchFn,
    ingest: {
      sources: async () => [brew],
      putRaw: async (path) => void putRaw.push(path),
      insertIssue: async (row) => {
        if (rows.has(row.messageId)) return null;
        const id = `id-${rows.size + 1}`;
        rows.set(row.messageId, { ...row, id });
        return { id };
      },
      findIssueId: async (m) => rows.get(m)?.id ?? null,
      timeZone: "America/New_York",
    },
    ...opts.env,
  };
  return { deps, rows, putRaw, calls };
}

function signed(payload: object, secret = SECRET) {
  const body = JSON.stringify(payload);
  const id = "msg_1";
  const ts = new Date();
  const signature = new Webhook(secret).sign(id, ts, body);
  return new Request("https://masonbair.com/api/news/inbound", {
    method: "POST",
    body,
    headers: { "svix-id": id, "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": signature },
  });
}
const received = { type: "email.received", data: { email_id: "em_1" } };

describe("handleInbound", () => {
  it("answers 503 when an env value is missing", async () => {
    for (const key of ["secret", "apiKey", "forwardFrom"] as const) {
      const { deps } = setup({ env: { [key]: undefined } });
      expect((await handleInbound(signed(received), deps)).status).toBe(503);
    }
  });

  it("rejects an unsigned request and stores nothing", async () => {
    const { deps, putRaw, calls } = setup();
    const res = await handleInbound(new Request("https://x.test", { method: "POST", body: JSON.stringify(received) }), deps);
    expect(res.status).toBe(401);
    expect(putRaw).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("rejects a wrong signature", async () => {
    const other = "whsec_" + Buffer.from("another-secret-bytes-0123456789a").toString("base64");
    const { deps, putRaw } = setup();
    expect((await handleInbound(signed(received, other), deps)).status).toBe(401);
    expect(putRaw).toEqual([]);
  });

  it("rejects a body over 256 KB", async () => {
    const { deps } = setup();
    const req = new Request("https://x.test", { method: "POST", body: "x".repeat(256 * 1024 + 1) });
    expect((await handleInbound(req, deps)).status).toBe(413);
  });

  it("stores a valid email.received and marks it pending", async () => {
    const { deps, rows, putRaw, calls } = setup();
    const res = await handleInbound(signed(received), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "created" });
    expect(putRaw).toHaveLength(1);
    expect([...rows.values()][0].status).toBe("pending");
    expect(calls[0]).toEqual({ url: "https://api.resend.com/emails/receiving/em_1", auth: "Bearer re_test" });
    expect(calls[1].auth).toBeNull();
  });

  it("accepts data.id when email_id is absent", async () => {
    const { deps, calls } = setup();
    const res = await handleInbound(signed({ type: "email.received", data: { id: "em_2" } }), deps);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("https://api.resend.com/emails/receiving/em_2");
  });

  it("answers duplicate for the same event again", async () => {
    const { deps } = setup();
    await handleInbound(signed(received), deps);
    const res = await handleInbound(signed(received), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "duplicate" });
  });

  it("ignores other event types", async () => {
    const { deps, calls } = setup();
    const res = await handleInbound(signed({ type: "email.sent", data: { email_id: "em_1" } }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored" });
    expect(calls).toEqual([]);
  });

  it("answers 400 when the event has no email id", async () => {
    const { deps } = setup();
    expect((await handleInbound(signed({ type: "email.received", data: {} }), deps)).status).toBe(400);
  });

  it("answers 502 when Resend fails", async () => {
    const { deps, putRaw } = setup({ retrieveStatus: 500 });
    expect((await handleInbound(signed(received), deps)).status).toBe(502);
    expect(putRaw).toEqual([]);
  });

  it("answers 502 when the raw email is not ready", async () => {
    const { deps } = setup({ retrieved: { raw: null } });
    expect((await handleInbound(signed(received), deps)).status).toBe(502);
  });

  it("answers 502 for an http download_url", async () => {
    const { deps, putRaw } = setup({ retrieved: { raw: { download_url: "http://files.example.test/raw", expires_at: "x" } } });
    expect((await handleInbound(signed(received), deps)).status).toBe(502);
    expect(putRaw).toEqual([]);
  });

  it("quarantines when the forwarding address is missing", async () => {
    const { deps, rows } = setup({ retrieved: { headers: {}, received_for: ["news@in.masonbair.com"] } });
    await handleInbound(signed(received), deps);
    expect([...rows.values()][0].status).toBe("quarantined");
  });

  it("accepts forwarding named in received_for, case-insensitively", async () => {
    const { deps, rows } = setup({ retrieved: { headers: {}, received_for: ["FWD@example.test"] } });
    await handleInbound(signed(received), deps);
    expect([...rows.values()][0].status).toBe("pending");
  });

  it("quarantines when dkim does not pass", async () => {
    const { deps, rows } = setup({ retrieved: { authentication: { dkim: "fail" } } });
    await handleInbound(signed(received), deps);
    expect([...rows.values()][0].status).toBe("quarantined");
  });
});
