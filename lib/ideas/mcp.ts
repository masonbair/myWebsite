import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { monthSpend, type AiFeature } from "@/lib/ai/claude";
import { getIdeaPage, IDEA_FILTERS, listIdeas } from "./read";

export const MAX_IDEAS_LIMIT = 200;
export const DEFAULT_IDEAS_LIMIT = 50;
const DEFAULT_BUDGET_USD: Record<AiFeature, number> = { ideas: 20, news: 25, learn: 10 };
const BUDGET_VAR: Record<AiFeature, string> = {
  ideas: "IDEAS_MONTHLY_BUDGET_USD",
  news: "NEWS_MONTHLY_BUDGET_USD",
  learn: "LEARN_MONTHLY_BUDGET_USD",
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ideasListInput = z.object({
  status: z.enum(IDEA_FILTERS).optional().describe("Default active"),
  verdict: z.enum(["strong", "promising", "needs work", "weak"]).optional(),
  from: day.optional().describe("Created on or after this date, YYYY-MM-DD"),
  to: day.optional().describe("Created on or before this date, YYYY-MM-DD"),
  text: z.string().trim().min(1).max(200).optional().describe("Case-insensitive match in the title"),
  limit: z.number().int().min(1).max(MAX_IDEAS_LIMIT).optional().describe("Default 50"),
});
export const ideaGetInput = z.object({ id: z.uuid() });
export const aiCostsInput = z.object({ feature: z.enum(["ideas", "news"]).optional().describe("Default ideas") });

export class IdeaToolError extends Error {}

export async function ideasListTool(client: SupabaseClient, input: z.infer<typeof ideasListInput>) {
  const { ideas, total } = await listIdeas(client, input.status ?? "active");
  const text = input.text?.toLowerCase();
  const matched = ideas.filter(
    (idea) =>
      (!input.verdict || idea.verdict === input.verdict) &&
      (!input.from || idea.createdAt.slice(0, 10) >= input.from) &&
      (!input.to || idea.createdAt.slice(0, 10) <= input.to) &&
      (!text || idea.title.toLowerCase().includes(text)),
  );
  const limit = input.limit ?? DEFAULT_IDEAS_LIMIT;
  const shown = matched.slice(0, limit);
  const notes: string[] = [];
  if (matched.length > shown.length) notes.push(`Showing ${shown.length} of ${matched.length} matches; raise limit (max ${MAX_IDEAS_LIMIT}) or narrow the filters.`);
  if (total > ideas.length) notes.push(`Only the newest ${ideas.length} of ${total} ideas with this status were searched.`);
  return { ideas: shown, total: matched.length, ...(notes.length ? { note: notes.join(" ") } : {}) };
}

export async function ideaGetTool(client: SupabaseClient, id: string) {
  const page = await getIdeaPage(client, id);
  if (!page) throw new IdeaToolError(`no idea ${id}`);
  return page;
}

const cents = (n: number) => Math.round(n * 100) / 100;

function budgetFor(feature: AiFeature, env: NodeJS.ProcessEnv): number {
  const raw = env[BUDGET_VAR[feature]]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUDGET_USD[feature];
}

export async function aiCostsTool(client: SupabaseClient, feature: AiFeature, now: Date, env: NodeJS.ProcessEnv = process.env) {
  const spend = await monthSpend(client, feature, now);
  return {
    feature,
    thisMonth: cents(spend.thisMonth),
    lastMonth: cents(spend.lastMonth),
    byModel: Object.fromEntries(Object.entries(spend.byModel).map(([model, usd]) => [model, cents(usd)])),
    calls: spend.calls,
    monthlyBudgetUsd: budgetFor(feature, env),
  };
}
