import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
let blobGet: (...a: unknown[]) => Promise<unknown> = (...a) => get(...a);
vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({ get: (...a: unknown[]) => blobGet(...a) }));

const { loadRawEmail } = await import("@/lib/news/raw-email");
const { emailPlainText } = await import("@/lib/news/email-view");

const CONFIRM_URL = "https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc123?x=1&y=2";
const eml = [
  "From: Gmail Team <forwarding-noreply@google.com>",
  "To: someone@example.test",
  "Subject: Gmail Forwarding Confirmation",
  "Message-ID: <confirm-1@example.test>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "someone@example.test has requested to automatically forward mail to you.",
  "Click the link below to confirm the request:",
  CONFIRM_URL,
  "",
].join("\r\n");

const ok = (body: string, size = body.length) => ({
  statusCode: 200,
  stream: new Response(body).body,
  headers: new Headers(),
  blob: { size },
});

describe("loadRawEmail", () => {
  beforeEach(() => {
    get.mockReset();
    blobGet = (...a) => get(...a);
  });

  it("reads the private blob and gives text that contains the confirmation link", async () => {
    get.mockResolvedValue(ok(eml));
    const email = await loadRawEmail("news/raw/confirm-1.eml");
    expect(get).toHaveBeenCalledWith("news/raw/confirm-1.eml", { access: "private" });
    expect(email?.subject).toBe("Gmail Forwarding Confirmation");
    expect(emailPlainText(email!)).toContain(CONFIRM_URL);
  });

  it("is null when the blob is missing", async () => {
    get.mockResolvedValue(null);
    expect(await loadRawEmail("x.eml")).toBeNull();
  });

  it("is null for a 304", async () => {
    get.mockResolvedValue({ statusCode: 304, stream: null, headers: new Headers(), blob: { size: null } });
    expect(await loadRawEmail("x.eml")).toBeNull();
  });

  it("is null for a blob over 10 MB without reading it", async () => {
    get.mockResolvedValue(ok(eml, 10_000_001));
    expect(await loadRawEmail("x.eml")).toBeNull();
  });

  it("is null when the read throws", async () => {
    // A plain function, because vitest flags a vi.fn that throws even when the caller catches it.
    blobGet = async () => {
      throw new Error("store unreachable");
    };
    expect(await loadRawEmail("x.eml")).toBeNull();
  });

  it("is null for an empty path without calling the store", async () => {
    expect(await loadRawEmail("")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
