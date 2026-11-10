import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { Agent, fetch as undiciFetch } from "undici";
import { readCappedBody } from "@/lib/hub/capped-body";

export type ReadableDeps = {
  /** Must accept undici's `dispatcher` init option (undici's own fetch does) so the connection uses the checked addresses. */
  fetchFn: typeof fetch;
  lookup: (host: string) => Promise<string[]>;
  timeoutMs?: number;
};

export type Readable = { text: string; title: string | null };

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_TEXT = 100_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Production deps: undici's fetch (so the pinned dispatcher is honored) and the system resolver. */
export const liveReadableDeps: ReadableDeps = {
  fetchFn: undiciFetch as unknown as typeof fetch,
  lookup: async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address),
};

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToInt(address: string): number {
  return address.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

function v4Blocked(address: string): boolean {
  const n = v4ToInt(address);
  return V4_BLOCKS.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4ToInt(base) / 2 ** (32 - bits)));
}

function v6Hextets(address: string): number[] | null {
  let text = address.toLowerCase();
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4ToInt(tail[1]);
    text = text.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest === undefined ? [] : rest ? rest.split(":") : [];
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const parts = [...left, ...Array(fill).fill("0"), ...right].map((h) => parseInt(h, 16));
  return parts.length === 8 && parts.every((h) => h >= 0 && h <= 0xffff) ? parts : null;
}

/** True unless `address` is a public unicast IP; anything unparseable counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return v4Blocked(address);
  if (version !== 6) return true;
  const h = v6Hextets(address);
  if (!h) return true;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return v4Blocked(`${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`);
  }
  // Only global unicast (2000::/3) is public; 6to4, Teredo and documentation prefixes can wrap or stand for inside addresses.
  if ((h[0] & 0xe000) !== 0x2000) return true;
  return h[0] === 0x2002 || (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0xdb8));
}

/** A `net` lookup that ignores the hostname and answers with the already-checked addresses, so DNS cannot change between check and connect. */
export function pinnedLookup(addresses: string[]): LookupFunction {
  const entries = addresses.map((address) => ({ address, family: isIP(address) }));
  return ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (options?.all) callback(null, entries);
    else callback(null, entries[0].address, entries[0].family);
  }) as LookupFunction;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}

async function safeAddresses(url: URL, deps: ReadableDeps, signal: AbortSignal): Promise<string[] | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await abortable(deps.lookup(host), signal);
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) return null;
  return addresses;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = contentType.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function readable(html: string): Readable | null {
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() || null;
  const article = new Readability(document as unknown as Document).parse();
  const text = (article?.textContent ?? "")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
  if (!text) return null;
  return { text, title: article?.title?.trim() || pageTitle };
}

/** Fetches a shared link once and returns its readable text, or null on any failure or unsafe target. */
export async function fetchReadable(url: string, deps: ReadableDeps): Promise<Readable | null> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS);
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addresses = await safeAddresses(current, deps, signal);
      if (!addresses) return null;
      const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
      try {
        const response = await deps.fetchFn(current.href, {
          redirect: "manual",
          signal,
          headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; masonbair-news/1.0)" },
          dispatcher,
        } as RequestInit);
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) return null;
          current = new URL(location, current);
          continue;
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !/^\s*text\/html\b/i.test(contentType)) {
          await response.body?.cancel();
          return null;
        }
        const bytes = await abortable(readCappedBody(response, MAX_BYTES), signal);
        return bytes ? readable(decode(bytes, contentType)) : null;
      } finally {
        void dispatcher.destroy().catch(() => {});
      }
    }
    return null;
  } catch {
    return null;
  }
}
