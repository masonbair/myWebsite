import { generateKeyPairSync } from "node:crypto";
import { dkimSign } from "mailauth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const record = `v=DKIM1; k=rsa; p=${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`;

/** TXT records for `sel._domainkey.<domain>` of every domain in `domains`, all holding the test key. */
export function testResolver(domains: string[], opts: { testing?: boolean } = {}) {
  return async (name: string, rrtype: string): Promise<string[][]> => {
    const domain = name.toLowerCase().replace(/^sel\._domainkey\./, "");
    if (rrtype === "TXT" && name.toLowerCase().startsWith("sel._domainkey.") && domains.includes(domain)) return [[opts.testing ? `${record}; t=y` : record]];
    throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: "ENOTFOUND" });
  };
}

/** Prepends a DKIM-Signature by `domain` with the test key. */
export async function signRaw(raw: Uint8Array | string, domain: string, opts: { maxBodyLength?: number } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const message = Buffer.from(raw);
  const { signatures, errors } = await dkimSign(message, {
    signatureData: [{ signingDomain: domain, selector: "sel", privateKey: pem, maxBodyLength: opts.maxBodyLength }],
  });
  if (errors.length) throw new Error(`dkimSign failed: ${errors.map((e) => e.err?.message).join(", ")}`);
  return new Uint8Array(Buffer.concat([Buffer.from(signatures), message]));
}
