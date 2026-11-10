import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alignedDkimFrom } from "@/lib/news/dkim";
import { signRaw, testResolver } from "./dkim-fixture";

const issue = readFileSync(new URL("./fixtures/issue.eml", import.meta.url), "utf8");
const brewDns = testResolver(["example-brew.test", "mail.example-brew.test", "evil.example"]);
const withFrom = (from: string) => issue.replace(/^From: .*$/m, `From: ${from}`);

describe("alignedDkimFrom", () => {
  it("returns the From address when the From domain signed it", async () => {
    expect(await alignedDkimFrom(await signRaw(issue, "example-brew.test"), brewDns)).toBe("news@example-brew.test");
  });

  it("accepts a signature by a parent of the From domain", async () => {
    const raw = await signRaw(withFrom("Brew <News@Mail.Example-Brew.test>"), "example-brew.test");
    expect(await alignedDkimFrom(raw, brewDns)).toBe("news@mail.example-brew.test");
  });

  it("rejects a signature by a child of the From domain", async () => {
    expect(await alignedDkimFrom(await signRaw(issue, "mail.example-brew.test"), brewDns)).toBeNull();
  });

  it("rejects mail whose From was changed after signing", async () => {
    const signed = Buffer.from(await signRaw(issue, "example-brew.test")).toString("utf8");
    const tampered = signed.replace("From: Daily Brew <news@example-brew.test>", "From: Daily Brew <news@other-brew.test>");
    expect(tampered).not.toBe(signed);
    expect(await alignedDkimFrom(new TextEncoder().encode(tampered), testResolver(["example-brew.test", "other-brew.test"]))).toBeNull();
  });

  it("rejects a valid signature by another domain", async () => {
    expect(await alignedDkimFrom(await signRaw(issue, "evil.example"), brewDns)).toBeNull();
  });

  it("rejects when the key lookup fails", async () => {
    const raw = await signRaw(issue, "example-brew.test");
    const servfail = async () => {
      throw Object.assign(new Error("queryTxt ESERVFAIL"), { code: "ESERVFAIL" });
    };
    expect(await alignedDkimFrom(raw, servfail)).toBeNull();
    expect(await alignedDkimFrom(raw, testResolver([]))).toBeNull();
  });

  it("rejects unsigned mail", async () => {
    expect(await alignedDkimFrom(new TextEncoder().encode(issue), brewDns)).toBeNull();
  });

  it("rejects a second From header added after signing", async () => {
    const signed = Buffer.from(await signRaw(issue, "example-brew.test")).toString("utf8");
    const raw = new TextEncoder().encode(`From: Evil <x@evil.example>\r\n${signed}`);
    expect(await alignedDkimFrom(raw, brewDns)).toBeNull();
  });

  it("rejects a key published in testing mode (t=y)", async () => {
    const raw = await signRaw(issue, "example-brew.test");
    expect(await alignedDkimFrom(raw, testResolver(["example-brew.test"], { testing: true }))).toBeNull();
  });

  it("refuses mail with more than 10 signatures without looking any key up", async () => {
    let raw: Uint8Array = new TextEncoder().encode(issue);
    for (let i = 0; i < 11; i++) raw = await signRaw(raw, "example-brew.test");
    let lookups = 0;
    const counting = async (name: string, rrtype: string) => {
      lookups++;
      return brewDns(name, rrtype);
    };
    expect(await alignedDkimFrom(raw, counting)).toBeNull();
    expect(lookups).toBe(0);
  });

  it("counts signatures whose header name is folded before the colon", async () => {
    const signedOnce = Buffer.from(await signRaw(issue, "example-brew.test")).toString("latin1");
    const [sigHeader] = signedOnce.split(/\r?\nFrom: /);
    const folded = sigHeader.replace(/^DKIM-Signature:/, "DKIM-Signature\r\n :");
    const raw = new TextEncoder().encode(`${`${folded}\r\n`.repeat(31)}${issue}`);
    let lookups = 0;
    const counting = async (name: string, rrtype: string) => {
      lookups++;
      return brewDns(name, rrtype);
    };
    expect(await alignedDkimFrom(raw, counting)).toBeNull();
    expect(lookups).toBe(0);
  });

  it("gives up when key lookups hang past the deadline", async () => {
    const raw = await signRaw(issue, "example-brew.test");
    const never = () => new Promise<string[][]>(() => {});
    const start = performance.now();
    expect(await alignedDkimFrom(raw, never, { timeoutMs: 50 })).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("rejects a signature by a public suffix", async () => {
    const raw = await signRaw(withFrom("Brew <news@brew.co.uk>"), "co.uk");
    const dns = testResolver(["co.uk"]);
    expect(await alignedDkimFrom(raw, dns)).toBeNull();
    expect(await alignedDkimFrom(await signRaw(withFrom("Brew <news@brew.co.uk>"), "brew.co.uk"), testResolver(["brew.co.uk"]))).toBe("news@brew.co.uk");
  });

  it("rejects a signature that leaves body bytes unsigned (l=)", async () => {
    const signed = Buffer.from(await signRaw(issue, "example-brew.test", { maxBodyLength: 20 })).toString("utf8");
    expect(await alignedDkimFrom(new TextEncoder().encode(signed), brewDns)).toBeNull();
  });
});
