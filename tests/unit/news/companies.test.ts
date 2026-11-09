import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanCompany, isUsExchange, normCompany, parseSecTickers, refreshSecTickers, SEC_USER_AGENT } from "@/lib/news/companies";

describe("normCompany", () => {
  it("drops case, punctuation and company suffixes", () => {
    expect(normCompany("NVIDIA Corp.")).toBe(normCompany("Nvidia"));
    expect(normCompany("Apple Inc.")).toBe("apple");
    expect(normCompany("Rolls-Royce Holdings plc")).toBe("rolls royce holdings");
    expect(normCompany("Acme Co., Ltd")).toBe("acme");
    expect(normCompany("  Meta   Platforms, Inc ")).toBe("meta platforms");
  });

  it("keeps a name that is only a suffix word", () => {
    expect(normCompany("Co")).toBe("co");
  });
});

describe("cleanCompany", () => {
  it("trims, collapses whitespace and caps the name at 80 characters", () => {
    expect(cleanCompany({ name: "  Open \n  AI ", ticker: null, exchange: null })).toEqual({ name: "Open AI", ticker: null, exchange: null });
    expect(cleanCompany({ name: "A".repeat(120), ticker: null, exchange: null })?.name).toHaveLength(80);
  });

  it("refuses markup, control characters, URLs and empty names", () => {
    expect(cleanCompany({ name: "<b>Evil</b>", ticker: null, exchange: null })).toBeNull();
    expect(cleanCompany({ name: "Evil > Good", ticker: null, exchange: null })).toBeNull();
    expect(cleanCompany({ name: "Bad\u0007Bell", ticker: null, exchange: null })).toBeNull();
    expect(cleanCompany({ name: "Visit https://evil.example", ticker: null, exchange: null })).toBeNull();
    expect(cleanCompany({ name: "www.evil.example", ticker: null, exchange: null })).toBeNull();
    expect(cleanCompany({ name: "   ", ticker: null, exchange: null })).toBeNull();
  });

  it("keeps a valid ticker, upper-cased, and drops a bad one", () => {
    expect(cleanCompany({ name: "Nvidia", ticker: "nvda", exchange: "nasdaq" })).toEqual({ name: "Nvidia", ticker: "NVDA", exchange: "NASDAQ" });
    expect(cleanCompany({ name: "Berkshire", ticker: "BRK.B", exchange: "NYSE" })?.ticker).toBe("BRK.B");
    expect(cleanCompany({ name: "X", ticker: "<script>", exchange: null })?.ticker).toBeNull();
    expect(cleanCompany({ name: "X", ticker: "1ABC", exchange: null })?.ticker).toBeNull();
    expect(cleanCompany({ name: "X", ticker: "ABCDEFGHIJK", exchange: null })?.ticker).toBeNull();
  });
});

describe("isUsExchange", () => {
  it("accepts US exchanges and a missing exchange only", () => {
    expect(isUsExchange(null)).toBe(true);
    expect(isUsExchange("NASDAQ")).toBe(true);
    expect(isUsExchange("NYSE American")).toBe(true);
    expect(isUsExchange("LSE")).toBe(false);
    expect(isUsExchange("TSE")).toBe(false);
  });
});

describe("parseSecTickers", () => {
  it("reads the SEC shape and skips bad rows and repeats", () => {
    const rows = parseSecTickers({
      "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
      "1": { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
      "2": { cik_str: "x", ticker: "BAD", title: "Bad" },
      "3": { cik_str: 1, ticker: "<b>", title: "Bad" },
      "4": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
    });
    expect(rows).toEqual([
      { ticker: "NVDA", cik: 1045810, title: "NVIDIA CORP" },
      { ticker: "BRK-B", cik: 1067983, title: "BERKSHIRE HATHAWAY INC" },
    ]);
    expect(parseSecTickers(null)).toEqual([]);
    expect(parseSecTickers([1, 2])).toEqual([]);
  });
});

function stateClient(lastRefreshed: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: lastRefreshed ? { value: lastRefreshed } : null, error: null });
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
  return { client: { from } as unknown as SupabaseClient, from };
}

describe("refreshSecTickers", () => {
  const now = new Date("2026-11-09T12:00:00Z");

  it("skips the fetch when the list was refreshed in the last 7 days", async () => {
    const { client } = stateClient("2026-11-05T12:00:00.000Z");
    const fetchFn = vi.fn();
    expect(await refreshSecTickers(client, fetchFn as unknown as typeof fetch, now)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends the agreed User-Agent and returns false on a failed response without writing", async () => {
    const { client, from } = stateClient("2026-10-01T00:00:00.000Z");
    const fetchFn = vi.fn().mockResolvedValue(new Response("nope", { status: 403 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await refreshSecTickers(client, fetchFn as unknown as typeof fetch, now)).toBe(false);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://www.sec.gov/files/company_tickers.json");
    expect(new Headers(init.headers).get("user-agent")).toBe("masonbair.com newsletter trends (https://masonbair.com)");
    expect(SEC_USER_AGENT).toBe("masonbair.com newsletter trends (https://masonbair.com)");
    expect(from).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("returns false when the body passes 5 MB", async () => {
    const { client, from } = stateClient(null);
    const big = new Response(new Uint8Array(5 * 1024 * 1024 + 1).fill(32));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await refreshSecTickers(client, vi.fn().mockResolvedValue(big) as unknown as typeof fetch, now)).toBe(false);
    expect(from).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("returns false on a thrown fetch", async () => {
    const { client } = stateClient(null);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await refreshSecTickers(client, vi.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch, now)).toBe(false);
    log.mockRestore();
  });
});
