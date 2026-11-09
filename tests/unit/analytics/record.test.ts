import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { sampleUnknownBot, visitFor, visitorHash } from "@/lib/analytics/record";

const CHROME = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const NOON = new Date("2026-11-09T17:00:00Z");

function request(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new NextRequest(`https://masonbair.com${path}`, { headers, method });
}

describe("visitFor", () => {
  it("records a human from ChatGPT with a hashed visitor id and no IP", async () => {
    const visit = await visitFor(
      request("/coffee", { "user-agent": CHROME, referer: "https://chatgpt.com/", "x-real-ip": "203.0.113.9", "x-vercel-ip-country": "us" }),
      "salt",
      NOON,
    );
    expect(visit).toMatchObject({
      p_path: "/coffee",
      p_kind: "human",
      p_agent: "",
      p_ref_host: "chatgpt.com",
      p_from_assistant: "ChatGPT",
      p_country: "US",
      p_ua_sample: "",
    });
    expect(visit?.p_visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(visit)).not.toContain("203.0.113.9");
  });

  it("gives bots no visitor hash", async () => {
    const visit = await visitFor(request("/", { "user-agent": "GPTBot/1.1", "x-real-ip": "1.2.3.4" }), "salt", NOON);
    expect(visit).toMatchObject({ p_kind: "ai", p_agent: "GPTBot", p_visitor_hash: null });
  });

  it("keeps a truncated user-agent only for unknown bots", async () => {
    const ua = `weird-tool/${"x".repeat(300)}`;
    const visit = await visitFor(request("/", { "user-agent": ua }), "salt", NOON);
    expect(visit?.p_ua_sample).toHaveLength(120);
  });

  it("skips Mason's signed-in browser", async () => {
    const req = request("/", { "user-agent": CHROME, cookie: "sb-abcd-auth-token.0=x" });
    expect(await visitFor(req, "salt", NOON)).toBeNull();
  });

  it("counts a browser's full page load", async () => {
    const visit = await visitFor(request("/coffee", { "user-agent": CHROME, "sec-fetch-dest": "document" }), "salt", NOON);
    expect(visit?.p_kind).toBe("human");
  });

  it.each([
    [{ "sec-fetch-dest": "empty" }, "GET"],
    [{ "sec-purpose": "prefetch" }, "GET"],
    [{}, "POST"],
  ])("skips prefetches and non-reads (%j %s)", async (headers, method) => {
    expect(await visitFor(request("/", { "user-agent": CHROME, ...headers }, method), "salt", NOON)).toBeNull();
  });
});

describe("visitorHash", () => {
  it("is stable within a day and changes the next day", async () => {
    const a = await visitorHash("s", "1.1.1.1", CHROME, NOON);
    const b = await visitorHash("s", "1.1.1.1", CHROME, new Date("2026-11-09T22:00:00Z"));
    const next = await visitorHash("s", "1.1.1.1", CHROME, new Date("2026-11-10T17:00:00Z"));
    expect(a).toBe(b);
    expect(next).not.toBe(a);
  });
});

describe("sampleUnknownBot", () => {
  it("lets a daily sample through and resets the next day", () => {
    const day = new Date("2030-01-01T17:00:00Z");
    const passed = Array.from({ length: 400 }, () => sampleUnknownBot(day)).filter(Boolean).length;
    expect(passed).toBe(300);
    expect(sampleUnknownBot(new Date("2030-01-02T17:00:00Z"))).toBe(true);
  });
});
