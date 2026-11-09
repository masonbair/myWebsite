import { dkimVerify } from "mailauth";
import { parseHeaders } from "mailauth/lib/tools";
import { getPublicSuffix } from "tldts";

// Each signature costs a DNS lookup and a body hash, and the sender picks how many there are.
const MAX_SIGNATURES = 10;
const VERIFY_TIMEOUT_MS = 10_000;

export type DnsResolve = (name: string, rrtype: string) => Promise<string[][] | string[]>;

function signatureCount(message: Buffer): number {
  const text = message.toString("latin1");
  const headerEnd = text.search(/\r?\n\r?\n/);
  // Same parser mailauth verifies with, so a name folded before its colon is still counted.
  const { parsed } = parseHeaders(Buffer.from(headerEnd >= 0 ? text.slice(0, headerEnd) : text, "latin1"));
  return parsed.filter((row) => row.key === "dkim-signature").length;
}

async function verifiedFrom(message: Buffer, resolve: DnsResolve): Promise<string | null> {
  const { headerFrom, results } = await dkimVerify(message, { resolver: resolve, rejectRsaSha1: true });
  if (headerFrom.length !== 1) return null;
  const from = headerFrom[0].trim().toLowerCase();
  const domain = from.slice(from.lastIndexOf("@") + 1);
  if (!from.includes("@") || !domain) return null;
  const aligned = results.some((r) => {
    const d = r.signingDomain?.trim().toLowerCase().replace(/\.$/, "");
    // An l= signature leaves bytes after it unsigned, and RFC 6376 says to treat t=y keys as unsigned.
    if (r.status.result !== "pass" || r.status.underSized || r.status.testing || !d) return false;
    if (getPublicSuffix(d) === d) return false;
    return domain === d || domain.endsWith(`.${d}`);
  });
  return aligned ? from : null;
}

/** The From address proven by a passing DKIM signature whose d= is the From domain or its parent, else null. */
export async function alignedDkimFrom(raw: Uint8Array, resolve: DnsResolve, opts: { timeoutMs?: number } = {}): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const message = Buffer.from(raw);
    if (signatureCount(message) > MAX_SIGNATURES) return null;
    const deadline = new Promise<null>((done) => {
      timer = setTimeout(() => done(null), opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
    });
    return await Promise.race([verifiedFrom(message, resolve), deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
