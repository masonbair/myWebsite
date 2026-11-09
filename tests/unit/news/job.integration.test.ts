import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runNewsJob, supabaseNewsJobStore } from "@/lib/news/job";

vi.mock("server-only", () => ({}));

// Run with: NEWS_TEST_DB=1 NEWS_TEST_SUPABASE_URL=http://127.0.0.1:55321 NEWS_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Refuses to load unless the API URL is local, because test rows can never be deleted.
const enabled = Boolean(process.env.NEWS_TEST_DB);
const apiUrl = process.env.NEWS_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.NEWS_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("NEWS_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("runNewsJob against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  it("extracts two pending issues into stories and trends, leaving the sponsor out of trends", async () => {
    const db = client();
    // A random far-future day and topic keep rows from earlier runs out of the checks, since rows are never deleted.
    const day = `${2100 + Math.floor(Math.random() * 800)}-03-${String(1 + Math.floor(Math.random() * 27)).padStart(2, "0")}`;
    const sponsorTopic = `t-${randomUUID().slice(0, 8)}`;
    const newsTopic = `t-${randomUUID().slice(0, 8)}`;
    const { error: topicError } = await db.from("news_topics").insert([
      { slug: sponsorTopic, name: "Sponsor only" },
      { slug: newsTopic, name: "News only" },
    ]);
    if (topicError) throw topicError;

    const ids: string[] = [];
    for (const source of ["morning-brew", "tech-brew"]) {
      const { data, error } = await db
        .from("news_issues")
        .insert({ source_id: source, message_id: `<${randomUUID()}@example.test>`, subject: "Synthetic", clean_text: "Synthetic issue text", published_on: day, status: "pending" })
        .select("id")
        .single();
      if (error) throw error;
      ids.push(data.id);
    }

    const create = vi.fn(async (request: { model: string }) => {
      if (request.model === "claude-haiku-5-5") {
        return { model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ same: false }) }], usage: { input_tokens: 50, output_tokens: 5 } };
      }
      return {
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              stories: [
                { headline: "A synthetic chip story", kind: "news", topics: [newsTopic], suggested_topic: null, companies: [], sentiment: 1, link: null },
                { headline: "A synthetic sponsor", kind: "sponsor", topics: [sponsorTopic], suggested_topic: null, companies: [], sentiment: 0, link: null },
              ],
            }),
          },
        ],
        usage: { input_tokens: 800, output_tokens: 120 },
      };
    });
    const anthropic = { beta: { messages: { create } } } as unknown as Anthropic;
    const fetchFn = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const store = { ...supabaseNewsJobStore(db, anthropic, fetchFn), fetchReadable: async () => null };

    const result = await runNewsJob({
      client: db,
      anthropic,
      model: "claude-sonnet-5-5",
      now: () => new Date(),
      deadlineMs: 240_000,
      cap: 1000,
      ntfyTopic: undefined,
      fetchFn,
      timeZone: "UTC",
      store,
    });

    expect(result.paused).toBe(false);
    expect(result.extracted).toEqual(expect.arrayContaining(ids));

    const { data: issues } = await db.from("news_issues").select("id, status, current_run_id").in("id", ids);
    expect(issues!.every((i) => i.status === "done" && i.current_run_id !== null)).toBe(true);

    const { data: stories } = await db.from("news_stories").select("issue_id, kind, run_id").in("issue_id", ids);
    expect(stories).toHaveLength(4);

    const { data: usage } = await db.from("ai_usage").select("news_issue_id, purpose").in("news_issue_id", ids);
    expect(usage!.map((u) => u.purpose).sort()).toEqual(["extract", "extract"]);

    const { data: trends } = await db.from("news_trends_daily").select("key, stories, mentions, sources").eq("day", day).eq("kind", "topic");
    expect(trends).toEqual([{ key: newsTopic, stories: 2, mentions: 2, sources: ["morning-brew", "tech-brew"] }]);
  });
  it("marks a shared row done and thin when its page cannot be read, and fails a refused issue with a retry time", async () => {
    const db = client();
    const marker = randomUUID();
    const { data: item, error: itemError } = await db
      .from("items")
      .insert({ title: `Shared ${marker}`, source: "share", description: `A synthetic note https://example.test/${marker}` })
      .select("id")
      .single();
    if (itemError) throw itemError;
    const { data: shared, error: sharedError } = await db.from("news_shared").select("id").eq("item_id", item.id).single();
    if (sharedError) throw sharedError;
    const { data: bad, error: badError } = await db
      .from("news_issues")
      .insert({ source_id: "mindstream", message_id: `<${marker}@example.test>`, subject: `refuse ${marker}`, clean_text: "Synthetic", status: "pending" })
      .select("id")
      .single();
    if (badError) throw badError;

    const create = vi.fn(async (request: { model: string; messages: { content: string }[] }) => {
      if (request.messages[0].content.includes(`refuse ${marker}`)) {
        return { model: "claude-sonnet-5-5", stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 0 } };
      }
      if (request.model === "claude-haiku-5-5") {
        return { model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ same: false }) }], usage: { input_tokens: 50, output_tokens: 5 } };
      }
      return {
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ stories: [{ headline: "A shared synthetic story", kind: "news", topics: [], suggested_topic: null, companies: [], sentiment: 0, link: null }] }) }],
        usage: { input_tokens: 300, output_tokens: 40 },
      };
    });
    const anthropic = { beta: { messages: { create } } } as unknown as Anthropic;
    const fetchFn = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const now = new Date();
    const result = await runNewsJob({
      client: db,
      anthropic,
      model: "claude-sonnet-5-5",
      now: () => now,
      deadlineMs: 240_000,
      cap: 1000,
      ntfyTopic: undefined,
      fetchFn,
      timeZone: "UTC",
      store: { ...supabaseNewsJobStore(db, anthropic, fetchFn), fetchReadable: async () => null },
    });

    expect(result.extracted).toContain(shared.id);
    expect(result.failed).toContain(bad.id);
    const { data: row } = await db.from("news_shared").select("status, thin, current_run_id, fetched_text").eq("id", shared.id).single();
    expect(row).toMatchObject({ status: "done", thin: true, fetched_text: null });
    const { data: stories } = await db.from("news_stories").select("source_id, issue_id").eq("shared_id", shared.id);
    expect(stories).toEqual([{ source_id: "shared", issue_id: null }]);
    const { data: usage } = await db.from("ai_usage").select("purpose, news_issue_id").eq("item_id", item.id);
    expect(usage).toEqual([{ purpose: "shared", news_issue_id: null }]);

    const { data: failed } = await db.from("news_issues").select("status, attempts, next_attempt_at, last_error").eq("id", bad.id).single();
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(Date.parse(failed!.next_attempt_at) - now.getTime()).toBe(60 * 60_000);
    expect(failed!.last_error).toMatch(/refusal/);
  });
});
