const DEFAULT_CAP_USD = 25;

/** The monthly spend cap in dollars: NEWS_MONTHLY_BUDGET_USD when it is a number above zero, otherwise 25. */
export function capUsd(env: Record<string, string | undefined>): number {
  const raw = env.NEWS_MONTHLY_BUDGET_USD?.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return DEFAULT_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
}
