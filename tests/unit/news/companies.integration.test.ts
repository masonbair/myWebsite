import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { refreshSecTickers, resolveCompanies } from "@/lib/news/companies";

// Run with: NEWS_TEST_DB=1 NEWS_TEST_SUPABASE_URL=http://127.0.0.1:55321 NEWS_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Refuses to load unless the API URL is local, because test rows can never be deleted.
const enabled = Boolean(process.env.NEWS_TEST_DB);
const apiUrl = process.env.NEWS_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.NEWS_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("NEWS_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("news companies against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const tag = () => randomUUID().replace(/-/g, "").slice(0, 8);

  it("matches by normalized name, inserts new ones once, and skips unsafe names", async () => {
    const t = tag();
    const first = await resolveCompanies(client(), [
      { name: `Zeta${t} Corp.`, ticker: null, exchange: null },
      { name: `<b>Evil${t}</b>`, ticker: null, exchange: null },
      { name: `zeta${t}`, ticker: null, exchange: null },
    ]);
    expect(first).toHaveLength(1);
    const again = await resolveCompanies(client(), [{ name: `ZETA${t} Inc`, ticker: null, exchange: null }]);
    expect(again).toEqual(first);
    const { data } = await client().from("news_companies").select("name, norm_name").eq("id", first[0]).single();
    expect(data).toEqual({ name: `Zeta${t} Corp.`, norm_name: `zeta${t}` });
  });

  it("matches an alias", async () => {
    const t = tag();
    const { data, error } = await client()
      .from("news_companies")
      .insert({ name: `Meta${t}`, norm_name: `meta${t}`, aliases: [`Facebook${t}`] })
      .select("id")
      .single();
    if (error) throw error;
    expect(await resolveCompanies(client(), [{ name: `facebook${t}, Inc.`, ticker: null, exchange: null }])).toEqual([data.id]);
  });

  it("verifies a ticker only when the SEC list has it and the exchange is US or missing", async () => {
    const t = tag().toUpperCase().replace(/[^A-Z]/g, "Q").slice(0, 5);
    const { error } = await client().from("news_sec_tickers").upsert({ ticker: `V${t}`, cik: 1, title: "Verified" });
    if (error) throw error;
    const ids = await resolveCompanies(client(), [
      { name: `Listed ${t}`, ticker: `V${t}`, exchange: "NASDAQ" },
      { name: `Unlisted ${t}`, ticker: `U${t}`, exchange: "NYSE" },
      { name: `Foreign ${t}`, ticker: `V${t}`, exchange: "LSE" },
      { name: `Bare ${t}`, ticker: `V${t}`, exchange: null },
    ]);
    const { data } = await client().from("news_companies").select("id, ticker, ticker_verified").in("id", ids);
    const byId = new Map((data ?? []).map((r) => [r.id, r]));
    expect(ids.map((id) => byId.get(id)?.ticker_verified)).toEqual([true, false, false, true]);
    expect(byId.get(ids[1])?.ticker).toBe(`U${t}`);
  });

  it("keeps an unverified ticker unverified and fills a missing ticker on a later match", async () => {
    const t = tag();
    const [id] = await resolveCompanies(client(), [{ name: `Quiet${t}`, ticker: null, exchange: null }]);
    await resolveCompanies(client(), [{ name: `Quiet${t}`, ticker: "ZZZQX", exchange: "NASDAQ" }]);
    await resolveCompanies(client(), [{ name: `Quiet${t}`, ticker: null, exchange: null }]);
    const { data } = await client().from("news_companies").select("ticker, ticker_verified").eq("id", id).single();
    expect(data).toEqual({ ticker: "ZZZQX", ticker_verified: false });
  });

  it("refreshes the SEC list once, then waits 7 days", async () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const stale = await client().from("hub_state").upsert({ key: "news:sec-refreshed", value: "2026-10-01T00:00:00.000Z" });
    if (stale.error) throw stale.error;
    const body = JSON.stringify({ "0": { cik_str: 42, ticker: "SECTSTA", title: "SEC TEST A" } });
    const fetchFn = vi.fn(async () => new Response(body, { status: 200 }));
    expect(await refreshSecTickers(client(), fetchFn as unknown as typeof fetch, now)).toBe(true);
    const { data } = await client().from("news_sec_tickers").select("cik, title").eq("ticker", "SECTSTA").single();
    expect(data).toEqual({ cik: 42, title: "SEC TEST A" });
    expect(await refreshSecTickers(client(), fetchFn as unknown as typeof fetch, new Date("2026-11-15T12:00:00Z"))).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
