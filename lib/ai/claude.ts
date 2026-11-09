import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";
export type AiFeature = "ideas" | "news";

/** USD per million tokens. Cache reads bill at 0.1x input, cache writes at 1.25x input; web search $0.01 each. */
export const PRICES: Record<ModelId, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
export const WEB_SEARCH_USD = 0.01;

export type ClaudeUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

/** Dollar cost of one call; `batch` halves it (Message Batches API price). */
export function costOf(model: ModelId, usage: ClaudeUsage, opts: { batch?: boolean } = {}): number {
  const p = PRICES[model];
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const tokens = ((input + cacheRead * 0.1 + cacheWrite * 1.25) * p.input + output * p.output) / 1_000_000;
  return (opts.batch ? tokens / 2 : tokens) + searches * WEB_SEARCH_USD;
}

export type UsageRow = {
  feature: AiFeature;
  model: ModelId;
  itemId: string | null;
  purpose: string;
  usage: ClaudeUsage;
  batch?: boolean;
  /** The news issue a charge belongs to (ai_usage.news_issue_id, migration 0010). */
  newsIssueId?: string;
};

/** Inserts one ai_usage row with the computed cost; returns the cost in USD. */
export async function recordUsage(client: SupabaseClient, row: UsageRow): Promise<number> {
  const { usage } = row;
  const cost = Math.round(costOf(row.model, usage, { batch: row.batch }) * 1e6) / 1e6;
  const { error } = await client.from("ai_usage").insert({
    feature: row.feature,
    model: row.model,
    input_tokens: usage.input_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    web_searches: usage.server_tool_use?.web_search_requests ?? 0,
    cost_usd: cost,
    item_id: row.itemId,
    purpose: row.purpose,
    ...(row.newsIssueId ? { news_issue_id: row.newsIssueId } : {}),
  });
  if (error) throw error;
  return cost;
}

/** Spend for one feature in UTC calendar months. */
export async function monthSpend(
  client: SupabaseClient,
  feature: AiFeature,
  now: Date,
): Promise<{ thisMonth: number; lastMonth: number; byModel: Record<string, number>; calls: number }> {
  const thisStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const lastStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const PAGE = 1000;
  const rows: { model: string; cost_usd: number | string; at: string }[] = [];
  // The hosted max_rows can be below PAGE, so a short page is not the end; only an empty one is.
  for (let from = 0; ; ) {
    const { data, error } = await client
      .from("ai_usage")
      .select("model, cost_usd, at")
      .eq("feature", feature)
      .gte("at", new Date(lastStart).toISOString())
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    from += data.length;
  }

  const out = { thisMonth: 0, lastMonth: 0, byModel: {} as Record<string, number>, calls: 0 };
  for (const r of rows) {
    const cost = Number(r.cost_usd);
    if (Date.parse(r.at) >= thisStart) {
      out.thisMonth += cost;
      out.byModel[r.model] = (out.byModel[r.model] ?? 0) + cost;
      out.calls += 1;
    } else {
      out.lastMonth += cost;
    }
  }
  return out;
}

const KEY_VAR: Record<AiFeature, string> = {
  ideas: "ANTHROPIC_API_KEY_IDEAS",
  news: "ANTHROPIC_API_KEY_NEWS",
};

/** Null when the feature's own key is unset, so callers answer 503 instead of throwing. */
export function anthropicClient(feature: AiFeature): Anthropic | null {
  const apiKey = process.env[KEY_VAR[feature]];
  return apiKey ? new Anthropic({ apiKey }) : null;
}
