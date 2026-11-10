import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanText, matchSource, parseEmail } from "@/lib/news/email";
import type { NewsSource } from "@/lib/news/types";

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const source = (over: Partial<NewsSource> = {}): NewsSource => ({
  id: "brew",
  name: "Daily Brew",
  senderAddresses: [],
  senderDomains: [],
  homepage: null,
  archivePattern: null,
  public: true,
  active: true,
  ...over,
});

describe("parseEmail", () => {
  it("reads subject, from and headers", async () => {
    const mail = await parseEmail(load("issue.eml"));
    expect(mail.subject).toBe("Markets wobble, chips surge");
    expect(mail.from).toBe("news@example-brew.test");
    expect(mail.messageId).toBe("<issue-1@mail.example-brew.test>");
    expect(mail.date?.toISOString()).toBe("2026-11-09T02:30:00.000Z");
    expect(mail.listPost).toContain("example-brew.test/archive");
    expect(mail.forwardedFor).toContain("fwd@example.test");
  });

  it("falls back to a sha256 id", async () => {
    const mail = await parseEmail(load("plain.eml"));
    expect(mail.messageId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(mail.html).toBeNull();
  });
});

describe("cleanText", () => {
  it("drops unsubscribe, footer and pixels; keeps the article link", async () => {
    const text = cleanText(await parseEmail(load("issue.eml")));
    expect(text).toContain("Chipmaker posts record quarter (https://click.example-brew.test/track)");
    expect(text).toContain("SPONSOR");
    expect(text).not.toMatch(/unsubscribe/i);
    expect(text).not.toMatch(/view in browser/i);
    expect(text).not.toContain("Footer junk");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("<");
  });

  it("drops preferences and referral lines", () => {
    const html = "<p>Story.</p><p><a href='https://x.test/p'>Manage your preferences</a></p><p>Refer a friend and earn swag</p><p>Keep me.</p>";
    const text = cleanText({
      messageId: "x", from: "", subject: "", date: null, forwardedFor: null, listPost: null, html, text: null,
    });
    expect(text).toBe("Story.\n\nKeep me.");
  });

  it("handles plain text", async () => {
    const text = cleanText(await parseEmail(load("plain.eml")));
    expect(text).toContain("Story one");
    expect(text).not.toMatch(/unsubscribe/i);
  });

  it("caps length", () => {
    const text = cleanText({
      messageId: "x", from: "", subject: "", date: null, forwardedFor: null, listPost: null,
      html: null, text: "a".repeat(300_000),
    });
    expect(text.length).toBe(200_000);
  });
});

describe("matchSource", () => {
  it("matches address first, then domain, case-insensitively", () => {
    const byAddr = source({ id: "a", senderAddresses: ["News@Example-Brew.test"] });
    const byDomain = source({ id: "d", senderDomains: ["example-brew.test"] });
    expect(matchSource("news@example-brew.test", [byDomain, byAddr])?.id).toBe("a");
    expect(matchSource("other@mail.example-brew.test", [byDomain, byAddr])?.id).toBe("d");
    expect(matchSource("x@evil-example-brew.test", [byDomain])).toBeNull();
    expect(matchSource("x@example-brew.test", [source({ senderDomains: ["example-brew.test"], active: false })])).toBeNull();
  });
});
