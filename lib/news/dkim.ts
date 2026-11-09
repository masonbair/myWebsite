import { dkimVerify } from "mailauth";

// Each signature costs a DNS lookup and a body hash, and the sender picks how many there are.
const MAX_SIGNATURES = 10;

export type DnsResolve = (name: string, rrtype: string) => Promise<string[][] | string[]>;

/** The From address proven by a passing DKIM signature whose d= is the From domain or its parent, else null. */
export async function alignedDkimFrom(raw: Uint8Array, resolve: DnsResolve): Promise<string | null> {
  try {
    const message = Buffer.from(raw);
    const text = message.toString("latin1");
    const headerEnd = text.search(/\r?\n\r?\n/);
    const header = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
    if ((header.match(/^dkim-signature[ \t]*:/gim) ?? []).length > MAX_SIGNATURES) return null;
    const { headerFrom, results } = await dkimVerify(message, { resolver: resolve, rejectRsaSha1: true });
    if (headerFrom.length !== 1) return null;
    const from = headerFrom[0].trim().toLowerCase();
    const domain = from.slice(from.lastIndexOf("@") + 1);
    if (!from.includes("@") || !domain) return null;
    const aligned = results.some((r) => {
      const d = r.signingDomain?.trim().toLowerCase().replace(/\.$/, "");
      // An l= signature leaves bytes after it unsigned, and RFC 6376 says to treat t=y keys as unsigned.
      if (r.status.result !== "pass" || r.status.underSized || r.status.testing || !d) return false;
      return domain === d || domain.endsWith(`.${d}`);
    });
    return aligned ? from : null;
  } catch {
    return null;
  }
}
