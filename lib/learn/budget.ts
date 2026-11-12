import type { SupabaseClient } from "@supabase/supabase-js";
import { monthSpend } from "@/lib/ai/claude";

const DEFAULT_CAP_USD = 10;

/** The monthly Learn to Earn cap in dollars: LEARN_MONTHLY_BUDGET_USD when it is a number above zero, otherwise 10. */
export function learnCapUsd(env: Record<string, string | undefined>): number {
  const raw = env.LEARN_MONTHLY_BUDGET_USD?.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return DEFAULT_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
}

/** Dollars spent this UTC calendar month on learn calls. */
export async function learnSpend(client: SupabaseClient, now: Date): Promise<number> {
  return (await monthSpend(client, "learn", now)).thisMonth;
}
