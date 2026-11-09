import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_CAP_USD = 25;

/** ai_usage purposes that count toward the monthly cap; backfill, rerun and compare have their own confirmed budgets. */
export const NEWS_CAPPED_PURPOSES = ["extract", "dedupe", "shared"] as const;
export type NewsCappedPurpose = (typeof NEWS_CAPPED_PURPOSES)[number];

/** The monthly spend cap in dollars: NEWS_MONTHLY_BUDGET_USD when it is a number above zero, otherwise 25. */
export function capUsd(env: Record<string, string | undefined>): number {
  const raw = env.NEWS_MONTHLY_BUDGET_USD?.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return DEFAULT_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
}

/** Dollars spent this UTC calendar month on news calls that count toward the cap. */
export async function newsCapSpend(client: SupabaseClient, now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const PAGE = 1000;
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("ai_usage")
      .select("cost_usd")
      .eq("feature", "news")
      .in("purpose", [...NEWS_CAPPED_PURPOSES])
      .gte("at", start)
      .lt("at", end)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) total += Number(r.cost_usd);
    if ((data ?? []).length < PAGE) break;
  }
  return total;
}
