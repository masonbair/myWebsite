// Queues reviews for open ideas the Ideas Lab never enrolled (made before it existed). Paid: each review is one Opus call.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ideas-review-older.ts
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type OlderDeps = {
  openIdeaIds(): Promise<string[]>;
  enrolledIds(ids: string[]): Promise<Set<string>>;
  /** Mean cost of the reviews saved so far, or null before the first one. */
  averageReviewCost(): Promise<number | null>;
  queue(ids: string[]): Promise<void>;
};

export type OlderPlan = { ids: string[]; perReview: number | null; estimate: number | null };

export async function planOlderReviews(deps: OlderDeps): Promise<OlderPlan> {
  const open = await deps.openIdeaIds();
  const enrolled = await deps.enrolledIds(open);
  const ids = open.filter((id) => !enrolled.has(id));
  const perReview = await deps.averageReviewCost();
  return { ids, perReview, estimate: perReview === null ? null : Math.round(ids.length * perReview * 100) / 100 };
}

/** Queues the counted ideas only when `answer` is exactly "yes"; returns how many were queued. */
export async function queueOlderReviews(deps: OlderDeps, answer: string): Promise<number> {
  if (answer.trim() !== "yes") return 0;
  const { ids } = await planOlderReviews(deps);
  if (ids.length > 0) await deps.queue(ids);
  return ids.length;
}

const BATCH = 100;

function supabaseDeps(client: SupabaseClient): OlderDeps {
  return {
    async openIdeaIds() {
      const { data, error } = await client.from("items").select("id").eq("list", "ideas").eq("state", "open").limit(5000);
      if (error) throw error;
      return (data as { id: string }[]).map((row) => row.id);
    },
    async enrolledIds(ids) {
      const enrolled = new Set<string>();
      for (let i = 0; i < ids.length; i += BATCH) {
        const { data, error } = await client.from("idea_settings").select("item_id").in("item_id", ids.slice(i, i + BATCH)).eq("enrolled", true);
        if (error) throw error;
        for (const row of data as { item_id: string }[]) enrolled.add(row.item_id);
      }
      return enrolled;
    },
    async averageReviewCost() {
      const { data, error } = await client.from("idea_reviews").select("cost_usd").order("id", { ascending: false }).limit(50);
      if (error) throw error;
      const costs = (data as { cost_usd: number }[]).map((row) => Number(row.cost_usd));
      return costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0) / costs.length;
    },
    async queue(ids) {
      const now = new Date();
      const rows = ids.map((id) => ({
        item_id: id,
        enrolled: true,
        schedule_from: now.toISOString().slice(0, 10),
        review_status: "waiting",
        review_requested_at: now.toISOString(),
      }));
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await client.from("idea_settings").upsert(rows.slice(i, i + BATCH), { onConflict: "item_id" });
        if (error) throw error;
      }
    },
  };
}

async function main(): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const deps = supabaseDeps(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  const plan = await planOlderReviews(deps);
  console.log(`${plan.ids.length} open ideas have never been reviewed.`);
  console.log(
    plan.estimate === null
      ? "No review has been saved yet, so there is no measured cost to estimate from."
      : `Estimated cost: $${plan.estimate.toFixed(2)} (${plan.ids.length} x $${plan.perReview!.toFixed(4)} per review).`,
  );
  if (plan.ids.length === 0) return 0;
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question('Type "yes" to queue them all: ');
  prompt.close();
  const queued = await queueOlderReviews(deps, answer);
  console.log(queued === 0 ? "Nothing queued." : `Queued ${queued} reviews. The ideas job picks them up every 15 minutes.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : "failed");
    process.exit(1);
  });
}
