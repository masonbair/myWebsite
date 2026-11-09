import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicClient, costOf, monthSpend, recordUsage } from "@/lib/ai/claude";

afterEach(() => vi.unstubAllEnvs());

function fakeClient(rows: Record<string, unknown>[], insertError: Error | null = null, maxRows = 1000) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: insertError };
      },
      select: () => {
        let feature = "";
        let since = "";
        const chain = {
          eq: (_c: string, v: string) => ((feature = v), chain),
          gte: (_c: string, v: string) => ((since = v), chain),
          order: () => chain,
          range: async (from: number, to: number) => ({
            data: rows.filter((r) => r.feature === feature && String(r.at) >= since).slice(from, Math.min(to + 1, from + maxRows)),
            error: null,
          }),
        };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserted };
}

describe("costOf", () => {
  it("prices input, output, cache and web search", () => {
    expect(costOf("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    expect(costOf("claude-haiku-5-5", { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(0.5);
    expect(
      costOf("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }),
    ).toBeCloseTo(0.4);
    expect(
      costOf("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }),
    ).toBeCloseTo(5);
    expect(
      costOf("claude-sonnet-5-5", {
        input_tokens: 0,
        output_tokens: 0,
        server_tool_use: { web_search_requests: 5 },
      }),
    ).toBeCloseTo(0.05);
  });

  it("counts missing or null fields as 0", () => {
    expect(
      costOf("claude-opus-5-5", {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
        server_tool_use: null,
      }),
    ).toBe(0);
  });
});

describe("anthropicClient", () => {
  it("is null for ideas when only the shared or news key is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY_IDEAS", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "shared");
    vi.stubEnv("ANTHROPIC_API_KEY_NEWS", "news");
    expect(anthropicClient("ideas")).toBeNull();
  });

  it("builds a client from the feature's own key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY_IDEAS", "k-ideas");
    vi.stubEnv("ANTHROPIC_API_KEY_NEWS", "");
    expect(anthropicClient("ideas")?.apiKey).toBe("k-ideas");
    expect(anthropicClient("news")).toBeNull();
  });
});

describe("recordUsage", () => {
  it("inserts the row with rounded cost and returns it", async () => {
    const { client, inserted } = fakeClient([]);
    const cost = await recordUsage(client, {
      feature: "ideas",
      model: "claude-sonnet-5-5",
      itemId: "abc",
      purpose: "review",
      usage: { input_tokens: 1234, output_tokens: 567, cache_read_input_tokens: 10, server_tool_use: { web_search_requests: 2 } },
    });
    expect(cost).toBeCloseTo(0.02 + 1234 * 2e-6 + 567 * 1e-5 + 10 * 2e-7, 6);
    expect(inserted[0]).toMatchObject({
      feature: "ideas",
      model: "claude-sonnet-5-5",
      input_tokens: 1234,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      output_tokens: 567,
      web_searches: 2,
      item_id: "abc",
      purpose: "review",
      cost_usd: cost,
    });
  });

  it("throws when the insert fails", async () => {
    const { client } = fakeClient([], new Error("boom"));
    await expect(
      recordUsage(client, { feature: "news", model: "claude-haiku-5-5", itemId: null, purpose: "x", usage: { input_tokens: 1, output_tokens: 1 } }),
    ).rejects.toThrow("boom");
  });
});

describe("monthSpend", () => {
  it("sums only the feature and UTC months asked for", async () => {
    const rows = [
      { feature: "ideas", model: "claude-opus-5-5", cost_usd: "1.5", at: "2026-11-01T00:00:00Z" },
      { feature: "ideas", model: "claude-haiku-5-5", cost_usd: 0.25, at: "2026-11-08T12:00:00Z" },
      { feature: "ideas", model: "claude-opus-5-5", cost_usd: 2, at: "2026-10-31T23:59:59Z" },
      { feature: "ideas", model: "claude-opus-5-5", cost_usd: 9, at: "2026-09-30T23:59:59Z" },
      { feature: "news", model: "claude-opus-5-5", cost_usd: 7, at: "2026-11-02T00:00:00Z" },
    ];
    const { client } = fakeClient(rows);
    const out = await monthSpend(client, "ideas", new Date("2026-11-09T10:00:00Z"));
    expect(out).toEqual({
      thisMonth: 1.75,
      lastMonth: 2,
      byModel: { "claude-opus-5-5": 1.5, "claude-haiku-5-5": 0.25 },
      calls: 2,
    });
  });

  it("handles January (last month is December)", async () => {
    const rows = [{ feature: "ideas", model: "m", cost_usd: 3, at: "2025-12-15T00:00:00Z" }];
    const { client } = fakeClient(rows);
    const out = await monthSpend(client, "ideas", new Date("2026-01-05T00:00:00Z"));
    expect(out.lastMonth).toBe(3);
    expect(out.thisMonth).toBe(0);
  });

  it("pages past 1000 rows so the total includes every page", async () => {
    const rows = Array.from({ length: 1250 }, () => ({
      feature: "ideas",
      model: "claude-opus-5-5",
      cost_usd: 1,
      at: "2026-11-02T00:00:00Z",
    }));
    const { client } = fakeClient(rows);
    const out = await monthSpend(client, "ideas", new Date("2026-11-09T10:00:00Z"));
    expect(out.calls).toBe(1250);
    expect(out.thisMonth).toBe(1250);
  });

  it("keeps paging when the server caps a page below 1000 rows", async () => {
    const rows = Array.from({ length: 1250 }, (_, i) => ({ feature: "ideas", model: "claude-opus-5-5", cost_usd: i, at: "2026-11-02T00:00:00Z" }));
    const { client } = fakeClient(rows, null, 500);
    const out = await monthSpend(client, "ideas", new Date("2026-11-09T10:00:00Z"));
    expect(out.calls).toBe(1250);
    expect(out.thisMonth).toBe((1249 * 1250) / 2);
  });
});
