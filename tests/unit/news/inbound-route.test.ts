import { Webhook } from "svix";
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "whsec_" + Buffer.from("test-secret-bytes-0123456789abcd").toString("base64");

describe("POST /api/news/inbound", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers 503 without touching Supabase when its env is missing", async () => {
    vi.stubEnv("RESEND_INBOUND_SECRET", SECRET);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NEWS_FORWARD_FROM", "fwd@example.test");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { POST } = await import("@/app/api/news/inbound/route");
    const body = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } });
    const ts = new Date();
    const req = new Request("https://masonbair.com/api/news/inbound", {
      method: "POST",
      body,
      headers: { "svix-id": "msg_1", "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": new Webhook(SECRET).sign("msg_1", ts, body) },
    });
    expect((await POST(req)).status).toBe(503);
  });
});
