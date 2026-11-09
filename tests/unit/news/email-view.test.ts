import { describe, expect, it } from "vitest";
import { MAX_SHOWN_CHARS, emailPlainText, linkSegments } from "@/lib/news/email-view";

describe("linkSegments", () => {
  it("turns a Gmail-style confirmation link into a link and keeps the rest as text", () => {
    const text =
      "mail-noreply@google.com has requested to automatically forward mail to you.\nClick the link below to confirm the request:\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc123?x=1&y=2\nIf you click the link, you agree.";
    expect(linkSegments(text)).toEqual([
      { type: "text", value: "mail-noreply@google.com has requested to automatically forward mail to you.\nClick the link below to confirm the request:\n" },
      { type: "link", value: "https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc123?x=1&y=2" },
      { type: "text", value: "\nIf you click the link, you agree." },
    ]);
  });

  it("leaves trailing punctuation and closing brackets outside the link", () => {
    expect(linkSegments("See (https://a.example/x). Or https://b.example/y, then stop.")).toEqual([
      { type: "text", value: "See (" },
      { type: "link", value: "https://a.example/x" },
      { type: "text", value: "). Or " },
      { type: "link", value: "https://b.example/y" },
      { type: "text", value: ", then stop." },
    ]);
  });

  it("only links http and https", () => {
    expect(linkSegments("javascript:alert(1) data:text/html,hi ftp://x.example")).toEqual([
      { type: "text", value: "javascript:alert(1) data:text/html,hi ftp://x.example" },
    ]);
  });

  it("never returns markup as anything but text", () => {
    expect(linkSegments('<script>alert(1)</script> <a href="https://a.example">x</a>')).toEqual([
      { type: "text", value: '<script>alert(1)</script> <a href="' },
      { type: "link", value: "https://a.example" },
      { type: "text", value: '">x</a>' },
    ]);
  });
});

describe("emailPlainText", () => {
  const base = { messageId: "m", from: "a@b.c", subject: "s", date: null, forwardedFor: null, listPost: null };

  it("prefers the text part", () => {
    expect(emailPlainText({ ...base, text: "plain body", html: "<p>html body</p>" })).toBe("plain body");
  });

  it("converts html to text and keeps the link addresses", () => {
    const out = emailPlainText({ ...base, text: null, html: '<p>Read <a href="https://a.example/p?x=1">the post</a></p><script>x()</script>' });
    expect(out).toContain("the post");
    expect(out).toContain("https://a.example/p?x=1");
    expect(out).not.toContain("x()");
  });

  it("caps the length", () => {
    expect(emailPlainText({ ...base, text: "a".repeat(MAX_SHOWN_CHARS + 50), html: null })).toHaveLength(MAX_SHOWN_CHARS);
  });

  it("gives an empty string when there is no body", () => {
    expect(emailPlainText({ ...base, text: null, html: null })).toBe("");
  });
});
