import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { grantMessage, newNonce, publicKeyBase64, signGrant, signingKey } from "@/lib/learn/grant";

// The raw 32-byte public key wrapped back into SPKI, the way Focus Lock will hold it.
function publicKeyFromRaw(rawBase64: string) {
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(rawBase64, "base64")]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

function seedOf(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  return pkcs8.subarray(pkcs8.length - 32).toString("base64");
}

describe("newNonce", () => {
  it("is always 22 base64url characters", () => {
    for (let i = 0; i < 1000; i++) expect(newNonce()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("grantMessage", () => {
  const nonce = "abcdefghijklmnopqrstuv";

  it("builds the exact signed bytes Focus Lock expects", () => {
    expect(grantMessage("2026-11-13", 3, nonce)).toBe(`fl-grant-v1|2026-11-13|com.instagram.android|3|${nonce}`);
  });

  it("refuses minutes outside 1..60, bad dates and bad nonces", () => {
    expect(() => grantMessage("2026-11-13", 0, nonce)).toThrow();
    expect(() => grantMessage("2026-11-13", 61, nonce)).toThrow();
    expect(() => grantMessage("2026-11-13", 2.5, nonce)).toThrow();
    expect(() => grantMessage("2026-13-01", 3, nonce)).toThrow();
    expect(() => grantMessage("2026-11-13", 3, "abc")).toThrow();
  });
});

describe("signing", () => {
  it("signs a grant that verifies against the raw public key", () => {
    const key = signingKey(seedOf())!;
    const grant = signGrant(key, "2026-11-13", 4);
    expect(grant.msg).toBe(`fl-grant-v1|2026-11-13|com.instagram.android|4|${grant.nonce}`);
    expect(Buffer.from(grant.sig, "base64")).toHaveLength(64);
    expect(Buffer.from(publicKeyBase64(key), "base64")).toHaveLength(32);
    expect(verify(null, Buffer.from(grant.msg, "utf8"), publicKeyFromRaw(publicKeyBase64(key)), Buffer.from(grant.sig, "base64"))).toBe(true);
  });

  it("gives no key unless the seed is exactly 32 bytes", () => {
    expect(signingKey(undefined)).toBeNull();
    expect(signingKey("")).toBeNull();
    expect(signingKey(Buffer.alloc(31).toString("base64"))).toBeNull();
    expect(signingKey("not base64!")).toBeNull();
  });
});
