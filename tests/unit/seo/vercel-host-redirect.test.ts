import { describe, expect, it } from "vitest";
import { vercelHostRedirects } from "@/lib/seo/vercel-host-redirect";

describe("vercelHostRedirects", () => {
  it("adds nothing outside production, so previews stay testable", () => {
    expect(vercelHostRedirects("preview")).toEqual([]);
    expect(vercelHostRedirects(undefined)).toEqual([]);
  });

  it("sends production vercel.app pages to masonbair.com permanently", () => {
    const [rule] = vercelHostRedirects("production");
    expect(rule.permanent).toBe(true);
    expect(rule.destination).toBe("https://masonbair.com/:path");
    const host = new RegExp(`^${rule.has?.[0].value}$`);
    expect(host.test("my-website-mu-gilt.vercel.app")).toBe(true);
    expect(host.test("masonbair.com")).toBe(false);
  });

  it("leaves API routes alone so webhooks keep working", () => {
    const [rule] = vercelHostRedirects("production");
    const path = new RegExp(`^/${rule.source.slice("/:path(".length, -1)}$`);
    expect(path.test("/coffee")).toBe(true);
    expect(path.test("/")).toBe(true);
    expect(path.test("/api/news/inbound")).toBe(false);
  });
});
