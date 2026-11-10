import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { newsCapSpend } from "@/lib/news/budget";

// Run with: NEWS_TEST_DB=1 NEWS_TEST_SUPABASE_URL=http://127.0.0.1:55321 NEWS_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Refuses to load unless the API URL is local, because ai_usage rows can never be deleted.
const enabled = Boolean(process.env.NEWS_TEST_DB);
const apiUrl = process.env.NEWS_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.NEWS_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("NEWS_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("newsCapSpend against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  it("sums capped news purposes this UTC month and ignores everything else", async () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 1)).toISOString();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59)).toISOString();
    const row = (feature: string, purpose: string, cost: number, at: string) => ({
      feature,
      model: "claude-sonnet-5-5",
      purpose,
      cost_usd: cost,
      at,
    });

    const before = await newsCapSpend(client(), now);
    const { error } = await client()
      .from("ai_usage")
      .insert([
        row("news", "extract", 0.5, thisMonth),
        row("news", "dedupe", 0.25, thisMonth),
        row("news", "shared", 0.125, thisMonth),
        row("news", "backfill", 4, thisMonth),
        row("news", "rerun", 4, thisMonth),
        row("news", "compare", 4, thisMonth),
        row("ideas", "extract", 4, thisMonth),
        row("ideas", "ideas", 4, thisMonth),
        row("news", "extract", 4, lastMonth),
      ]);
    if (error) throw error;
    const after = await newsCapSpend(client(), now);
    expect(after - before).toBeCloseTo(0.875, 6);
  });
});
