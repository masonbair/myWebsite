import type { SupabaseClient } from "@supabase/supabase-js";
import { readCappedBody } from "@/lib/hub/capped-body";
import type { ExtractedStory } from "@/lib/news/extract";

export type CompanyInput = ExtractedStory["companies"][number];

export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const SEC_USER_AGENT = "masonbair.com newsletter trends (https://masonbair.com)";
const SEC_STATE_KEY = "news:sec-refreshed";
const SEC_MAX_BYTES = 5 * 1024 * 1024;
const SEC_TIMEOUT_MS = 20_000;
const SEC_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_NAME = 80;
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const EXCHANGE = /^[A-Z][A-Z0-9 .\-]{0,29}$/;
const SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "ltd", "limited", "plc"]);
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "NYSEAMERICAN", "NYSEARCA", "NYSEMKT", "AMEX", "CBOE", "BATS", "OTC", "OTCMKTS"]);
// Company names are shown on the public page, so anything that could be markup or a link is refused.
const UNSAFE_NAME = /[<>\p{Cc}\p{Cf}]|https?:|www\.|[\p{L}\p{N}-]\.[a-z]{2,}\//iu;

/** Lowercase key for matching names: punctuation and company suffixes (inc, corp, co, ltd, plc) removed. */
export function normCompany(name: string): string {
  const words = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  const kept = words.filter((w) => !SUFFIXES.has(w));
  return (kept.length > 0 ? kept : words).join(" ");
}

/** A safe copy of a model-named company, or null when the name must not be stored. */
export function cleanCompany(c: CompanyInput): CompanyInput | null {
  if (typeof c.name !== "string") return null;
  const collapsed = c.name.replace(/\s+/g, " ").trim();
  if (UNSAFE_NAME.test(collapsed)) return null;
  const name = Array.from(collapsed).slice(0, MAX_NAME).join("").trim();
  if (!name || !normCompany(name)) return null;
  const ticker = c.ticker?.trim().toUpperCase() ?? "";
  const exchange = c.exchange?.replace(/\s+/g, " ").trim().toUpperCase() ?? "";
  return {
    name,
    ticker: TICKER.test(ticker) ? ticker : null,
    exchange: EXCHANGE.test(exchange) ? exchange : null,
  };
}

/** True for a US exchange or none given; only those tickers can be checked against the SEC list. */
export function isUsExchange(exchange: string | null): boolean {
  return exchange === null || US_EXCHANGES.has(exchange.toUpperCase().replace(/[\s.\-]/g, ""));
}

// The SEC writes class shares with a dash (BRK-B) where newsletters often use a dot (BRK.B).
const secForm = (ticker: string) => ticker.replace(/\./g, "-");

type CompanyRow = {
  id: number;
  norm_name: string;
  aliases: string[];
  ticker: string | null;
  exchange: string | null;
  ticker_verified: boolean;
};

async function secTickersIn(client: SupabaseClient, tickers: string[]): Promise<Set<string>> {
  if (tickers.length === 0) return new Set();
  const { data, error } = await client.from("news_sec_tickers").select("ticker").in("ticker", [...new Set(tickers.map(secForm))]);
  if (error) throw error;
  return new Set((data ?? []).map((r: { ticker: string }) => r.ticker));
}

/** Matches each company to news_companies by name or alias, adding new ones; returns ids in input order, without repeats. */
export async function resolveCompanies(client: SupabaseClient, companies: CompanyInput[]): Promise<number[]> {
  const byNorm = new Map<string, CompanyInput>();
  for (const raw of companies) {
    const c = cleanCompany(raw);
    if (!c) {
      console.error("news companies: skipped an unsafe company name");
      continue;
    }
    const norm = normCompany(c.name);
    const seen = byNorm.get(norm);
    if (!seen) byNorm.set(norm, c);
    else if (!seen.ticker && c.ticker) byNorm.set(norm, { ...seen, ticker: c.ticker, exchange: c.exchange });
  }
  if (byNorm.size === 0) return [];
  const norms = [...byNorm.keys()];

  const columns = "id, norm_name, aliases, ticker, exchange, ticker_verified";
  const [direct, aliased] = await Promise.all([
    client.from("news_companies").select(columns).in("norm_name", norms),
    // Aliases are typed by hand in any case, so they are normalized here; few companies have any.
    client.from("news_companies").select(columns).neq("aliases", "{}"),
  ]);
  if (direct.error) throw direct.error;
  if (aliased.error) throw aliased.error;
  const found = new Map<string, CompanyRow>();
  for (const row of (aliased.data ?? []) as CompanyRow[]) {
    for (const alias of row.aliases) if (byNorm.has(normCompany(alias))) found.set(normCompany(alias), row);
  }
  for (const row of (direct.data ?? []) as CompanyRow[]) found.set(row.norm_name, row);

  const tickers = [...byNorm.values()].flatMap((c) => (c.ticker ? [c.ticker] : []));
  for (const row of found.values()) if (row.ticker && !row.ticker_verified) tickers.push(row.ticker);
  const onSec = await secTickersIn(client, tickers);
  const verified = (ticker: string | null, exchange: string | null) => Boolean(ticker && onSec.has(secForm(ticker)) && isUsExchange(exchange));

  for (const [norm, row] of found) {
    const c = byNorm.get(norm)!;
    let patch: Record<string, unknown> | null = null;
    if (!row.ticker && c.ticker) {
      patch = { ticker: c.ticker, exchange: c.exchange, ticker_verified: verified(c.ticker, c.exchange) };
    } else if (!row.ticker_verified && verified(row.ticker, row.exchange)) {
      // The SEC list may have been empty or stale when the company was first added.
      patch = { ticker_verified: true };
    }
    if (patch) {
      const { error } = await client.from("news_companies").update(patch).eq("id", row.id);
      if (error) throw error;
    }
  }

  const missing = norms.filter((n) => !found.has(n));
  if (missing.length > 0) {
    const rows = missing.map((norm) => {
      const c = byNorm.get(norm)!;
      return { name: c.name, norm_name: norm, ticker: c.ticker, exchange: c.exchange, ticker_verified: verified(c.ticker, c.exchange) };
    });
    // ignoreDuplicates lets a concurrent run win the insert; the select below picks up its row.
    const { error } = await client.from("news_companies").upsert(rows, { onConflict: "norm_name", ignoreDuplicates: true });
    if (error) throw error;
    const { data, error: readError } = await client.from("news_companies").select(columns).in("norm_name", missing);
    if (readError) throw readError;
    for (const row of (data ?? []) as CompanyRow[]) found.set(row.norm_name, row);
  }

  return [...new Set(norms.flatMap((n) => (found.has(n) ? [found.get(n)!.id] : [])))];
}

export type SecTicker = { ticker: string; cik: number; title: string };

/** Rows from the SEC's company_tickers.json ({ "0": { cik_str, ticker, title }, ... }); bad rows and repeats are skipped. */
export function parseSecTickers(json: unknown): SecTicker[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const out = new Map<string, SecTicker>();
  for (const entry of Object.values(json as Record<string, unknown>)) {
    const e = entry as { cik_str?: unknown; ticker?: unknown; title?: unknown } | null;
    if (!e || typeof e.ticker !== "string" || typeof e.title !== "string") continue;
    if (typeof e.cik_str !== "number" || !Number.isSafeInteger(e.cik_str)) continue;
    const ticker = e.ticker.trim().toUpperCase();
    if (!TICKER.test(ticker) || out.has(ticker)) continue;
    out.set(ticker, { ticker, cik: e.cik_str, title: e.title.trim().slice(0, 200) });
  }
  return [...out.values()];
}

// A write failure only delays verification, so the job keeps going and the next run tries again.
function secWriteFailed(error: { message: string }): false {
  console.error(`news sec tickers: saving the list failed: ${error.message}`);
  return false;
}

/** Reloads the SEC ticker list at most once per 7 days; false when a due refresh failed (the old table is kept). */
export async function refreshSecTickers(client: SupabaseClient, fetchFn: typeof fetch, now: Date): Promise<boolean> {
  const { data: state, error: stateError } = await client.from("hub_state").select("value").eq("key", SEC_STATE_KEY).maybeSingle();
  if (stateError) throw stateError;
  const last = typeof state?.value === "string" ? Date.parse(state.value) : NaN;
  const age = now.getTime() - last;
  if (age >= 0 && age < SEC_EVERY_MS) return true;

  let rows: SecTicker[];
  try {
    const res = await fetchFn(SEC_TICKERS_URL, {
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(SEC_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await readCappedBody(res, SEC_MAX_BYTES);
    if (!body) throw new Error("body over 5 MB");
    rows = parseSecTickers(JSON.parse(new TextDecoder().decode(body)));
    if (rows.length === 0) throw new Error("no tickers in the reply");
  } catch (err) {
    console.error(`news sec tickers: refresh failed, keeping the old list: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  const refreshedAt = now.toISOString();
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => ({ ...r, refreshed_at: refreshedAt }));
    const { error } = await client.from("news_sec_tickers").upsert(chunk, { onConflict: "ticker" });
    if (error) return secWriteFailed(error);
  }
  const { error } = await client.from("hub_state").upsert({ key: SEC_STATE_KEY, value: refreshedAt, updated_at: refreshedAt });
  if (error) return secWriteFailed(error);
  return true;
}
