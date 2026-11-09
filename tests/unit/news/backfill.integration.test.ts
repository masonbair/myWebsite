import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { collect, importMessages, reclean, runEstimate } from "@/lib/news/backfill";
import { supabaseBackfillStore } from "@/lib/news/backfill-store";
import { createIngestDeps } from "@/lib/news/ingest-store";

// Run with: NEWS_TEST_DB=1 NEWS_TEST_SUPABASE_URL=http://127.0.0.1:55321 NEWS_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Refuses to load unless the API URL is local, because test rows can never be deleted.
const enabled = Boolean(process.env.NEWS_TEST_DB);
const apiUrl = process.env.NEWS_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.NEWS_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("NEWS_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

function email(tag: string, n: number): Uint8Array {
  return new TextEncoder().encode(
    [
      `From: Dry Run <crew@${tag}.example.test>`,
      "To: reader@example.test",
      `Subject: Synthetic issue ${n}`,
      `Date: Mon, 0${n} Feb 2026 12:00:00 +0000`,
      `Message-ID: <backfill-${tag}-${n}@example.test>`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      `Synthetic story ${n} for run ${tag}.`,
      "",
    ].join("\r\n"),
  );
}

function stubAnthropic(tag: string) {
  const sent: string[] = [];
  const reply = (customId: string) => ({
    custom_id: customId,
    result: {
      type: "succeeded",
      message: {
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              stories: [
                {
                  headline: `Dry run ${tag} story for ${customId}`,
                  kind: "news",
                  topics: ["chips"],
                  suggested_topic: null,
                  companies: [],
                  sentiment: 0,
                  link: null,
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 900, output_tokens: 100 },
      },
    },
  });
  const client = {
    beta: {
      messages: {
        countTokens: async () => ({ input_tokens: 900 }),
        create: async () => ({
          model: "claude-haiku-5-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"same":false}' }],
          usage: { input_tokens: 50, output_tokens: 5 },
        }),
        batches: {
          create: async (p: { requests: { custom_id: string }[] }) => {
            sent.push(...p.requests.map((r) => r.custom_id));
            return { id: `stub-${tag}`, processing_status: "in_progress" };
          },
          retrieve: async (id: string) => ({ id, processing_status: "ended" }),
          results: async () =>
            (async function* () {
              for (const id of sent) yield reply(id);
            })(),
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

describe.skipIf(!enabled)("backfill dry run against local Supabase", () => {
  it("imports 5 emails, submits to a stub batch, collects stories and usage, and repeats safely", async () => {
    const db = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const tag = randomUUID().slice(0, 8);
    const quiet = () => {};
    const raws = new Map<string, Uint8Array>();
    const deps = createIngestDeps(db, async (path, raw) => void raws.set(path, raw), "America/New_York");
    const mail = () => (async function* () {
      for (let n = 1; n <= 5; n++) yield email(tag, n);
    })();

    const source = { id: `dry-${tag}`, name: `Dry run ${tag}`, sender_domains: [`${tag}.example.test`], public: true };
    expect((await db.from("news_sources").insert(source)).error).toBeNull();

    const first = await importMessages(mail(), deps, { since: "2026-01-01", log: quiet });
    expect(first).toMatchObject({ created: 5, duplicates: 0, bySource: { [source.name]: 5 } });
    expect(await importMessages(mail(), deps, { since: "2026-01-01", log: quiet })).toMatchObject({ created: 0, duplicates: 5 });

    const { data: mine } = await db.from("news_issues").select("id").like("message_id", `<backfill-${tag}-%`);
    const ids = (mine ?? []).map((r: { id: string }) => r.id);
    expect(ids).toHaveLength(5);

    const { client, sent } = stubAnthropic(tag);
    const store = supabaseBackfillStore(db, client);
    const before = await store.getBatches();
    try {
      // Earlier dry runs may have left other submissions open; this run only checks its own.
      await store.setBatches({ submissions: [] });
      expect(await reclean(store, async (p) => raws.get(p) ?? null, { log: quiet })).toMatchObject({ fixed: 0 });
      const outcome = await runEstimate(store, client, { scope: { kind: "backfill" }, model: "claude-haiku-5-5", ask: async () => "yes", log: quiet });
      expect(outcome).toBe("sent");
      expect(sent).toEqual(expect.arrayContaining(ids));

      await collect(store, client, { log: quiet, ask: async () => "yes" });
      await collect(store, client, { log: quiet, ask: async () => "yes" });

      const { data: issues } = await db.from("news_issues").select("status, current_run_id").in("id", ids);
      expect(issues!.every((i) => i.status === "done" && i.current_run_id !== null)).toBe(true);
      const runId = issues![0].current_run_id;
      const { data: run } = await db.from("news_extraction_runs").select("kind, model").eq("id", runId).single();
      expect(run).toEqual({ kind: "backfill", model: "claude-haiku-5-5" });
      const { data: stories } = await db.from("news_stories").select("id, cluster_id, story_date").in("issue_id", ids);
      expect(stories).toHaveLength(5);
      expect(stories!.every((s) => s.cluster_id !== null)).toBe(true);
      const { data: usage } = await db
        .from("ai_usage")
        .select("purpose, cost_usd")
        .eq("feature", "news")
        .eq("purpose", "backfill")
        .gte("at", new Date(Date.now() - 10 * 60_000).toISOString());
      expect((usage ?? []).length).toBeGreaterThanOrEqual(5);
      const { data: trend } = await db.from("news_trends_daily").select("day").eq("kind", "topic").eq("key", "chips").gte("day", "2026-02-01").lte("day", "2026-02-05");
      expect((trend ?? []).length).toBeGreaterThan(0);
    } finally {
      await store.setBatches(before ?? { submissions: [] });
    }
  });
});
