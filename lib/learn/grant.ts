import { createPrivateKey, createPublicKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { FOCUSLOCK_PACKAGE, type SignedGrant } from "./types";

const NONCE = /^[A-Za-z0-9_-]{22}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SEED_BYTES = 32;
const RAW_PUBLIC_BYTES = 32;

/** 16 random bytes as base64url, no padding: 22 characters. */
export function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

function isRealDate(date: string): boolean {
  return DATE.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

/** The exact bytes Focus Lock verifies; throws on anything it would refuse. */
export function grantMessage(date: string, minutes: number, nonce: string): string {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error(`grant minutes must be 1..60, got ${minutes}`);
  if (!isRealDate(date)) throw new Error(`grant date must be YYYY-MM-DD, got ${date}`);
  if (!NONCE.test(nonce)) throw new Error("grant nonce must be 22 base64url characters");
  return `fl-grant-v1|${date}|${FOCUSLOCK_PACKAGE}|${minutes}|${nonce}`;
}

/** The Ed25519 key from LEARN_GRANT_PRIVATE_KEY (base64 32-byte seed), or null when it is missing or malformed. */
export function signingKey(seedBase64: string | undefined): KeyObject | null {
  if (!seedBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(seedBase64)) return null;
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length !== SEED_BYTES) return null;
  try {
    return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  } catch {
    return null;
  }
}

export function signGrant(key: KeyObject, date: string, minutes: number): SignedGrant {
  const nonce = newNonce();
  const msg = grantMessage(date, minutes, nonce);
  const sig = sign(null, Buffer.from(msg, "utf8"), key).toString("base64");
  return { date, minutes, nonce, msg, sig };
}

/** The raw 32-byte public key, base64, as Focus Lock builds it in. */
export function publicKeyBase64(key: KeyObject): string {
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - RAW_PUBLIC_BYTES).toString("base64");
}
