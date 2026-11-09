import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordUsage, type UsageRow } from "@/lib/ai/claude";
import { BATCH_STATE_KEY, type BackfillStore, type BackfillUsage, type BatchState, type IssueForExtract } from "@/lib/news/backfill";
import { resolveCompanies } from "@/lib/news/companies";
import { assignClusters } from "@/lib/news/dedupe";
import type { IssueStatus } from "@/lib/news/types";

const PAGE = 1000;
const ISSUE_COLUMNS = "id, source_id, subject, published_on, received_at, clean_text, status, current_run_id, raw_path, last_error, source:news_sources(name)";

type IssueRow = {
  id: string;
  source_id: string | null;
  subject: string;
  published_on: string | null;
  received_at: string;
  clean_text: string;
  status: IssueStatus;
  current_run_id: number | null;
  raw_path: string;
  last_error: string | null;
  source: { name: string } | null;
};

const toIssue = (r: IssueRow): IssueForExtract => ({
  id: r.id,
  sourceId: r.source_id ?? "",
  sourceName: r.source?.name ?? r.source_id ?? "unknown",
  subject: r.subject,
  publishedOn: r.published_on ?? r.received_at.slice(0, 10),
  cleanText: r.clean_text,
  status: r.status,
  currentRunId: r.current_run_id,
  rawPath: r.raw_path,
  lastError: r.last_error,
});

function check<T>(result: { data: T | null; error: unknown }): T | null {
  if (result.error) throw result.error;
  return result.data;
}

function rows<T>(result: { data: T[] | null; error: unknown }): T[] {
  return check(result) ?? [];
}

/** BackfillStore over Supabase with the service role; `anthropic` is only needed for the Haiku dedupe calls at collect. */
export function supabaseBackfillStore(client: SupabaseClient, anthropic: Anthropic | null): BackfillStore {
  return {
    async issues(scope) {
      const out: IssueForExtract[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = client.from("news_issues").select(ISSUE_COLUMNS).not("source_id", "is", null);
        query =
          scope.kind === "backfill"
            ? query.eq("status", "backfill").neq("clean_text", "")
            : query.eq("status", "done").gte("published_on", scope.from).lte("published_on", scope.to);
        const page = rows(await query.order("received_at").order("id").range(from, from + PAGE - 1)) as unknown as IssueRow[];
        out.push(...page.map(toIssue));
        if (page.length < PAGE) break;
      }
      return out;
    },

    async issue(id) {
      const row = check(await client.from("news_issues").select(ISSUE_COLUMNS).eq("id", id).maybeSingle()) as unknown as IssueRow | null;
      return row ? toIssue(row) : null;
    },

    async topics() {
      return rows(await client.from("news_topics").select("slug, name").eq("active", true).order("slug"));
    },

    async getBatches() {
      const { data, error } = await client.from("hub_state").select("value").eq("key", BATCH_STATE_KEY).maybeSingle();
      if (error) throw error;
      return (data?.value as BatchState | undefined) ?? null;
    },

    async setBatches(state) {
      check(await client.from("hub_state").upsert({ key: BATCH_STATE_KEY, value: state, updated_at: new Date().toISOString() }));
    },

    async createRun(kind, model, promptVersion) {
      const { data, error } = await client
        .from("news_extraction_runs")
        .insert({ model, prompt_version: promptVersion, kind })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as number;
    },

    async storiesExist(issueId, runId) {
      return rows(await client.from("news_stories").select("id").eq("issue_id", issueId).eq("run_id", runId).limit(1)).length > 0;
    },

    async writeStories(runId, issue, stories) {
      if (stories.length === 0) return [];
      const inserts = [];
      for (const s of stories) {
        inserts.push({
          run_id: runId,
          issue_id: issue.id,
          source_id: s.sourceId,
          story_date: s.storyDate,
          headline: s.headline,
          kind: s.kind,
          sentiment: s.sentiment,
          topics: s.topics,
          suggested_topic: s.suggestedTopic,
          company_ids: await resolveCompanies(client, s.companies),
          link: s.link,
        });
      }
      const data = rows(await client.from("news_stories").insert(inserts).select("id").order("id"));
      return data.map((r: { id: number }) => r.id);
    },

    async markDone(issueId, runId) {
      check(
        await client
          .from("news_issues")
          .update({ status: "done", current_run_id: runId, last_error: null, claimed_at: null, next_attempt_at: null })
          .eq("id", issueId),
      );
    },

    async markFailed(issueId, error) {
      check(
        await client
          .from("news_issues")
          .update({ status: "failed", last_error: error, attempts: 0, next_attempt_at: null, claimed_at: null })
          .eq("id", issueId),
      );
    },

    async recordUsage(row: BackfillUsage) {
      try {
        await recordUsage(client, row as UsageRow);
      } catch (e) {
        // Until migration 0010 adds ai_usage.news_issue_id, PostgREST rejects the unknown column.
        if ((e as { code?: string }).code !== "PGRST204" || !row.newsIssueId) throw e;
        await recordUsage(client, { ...row, newsIssueId: undefined } as UsageRow);
      }
    },

    async unclusteredStoryIds(runId) {
      const ids: number[] = [];
      for (let from = 0; ; from += PAGE) {
        const page = rows(
          await client
            .from("news_stories")
            .select("id")
            .eq("run_id", runId)
            .eq("kind", "news")
            .is("cluster_id", null)
            .order("story_date")
            .order("id")
            .range(from, from + PAGE - 1),
        );
        ids.push(...page.map((r: { id: number }) => r.id));
        if (page.length < PAGE) break;
      }
      return ids;
    },

    async cluster(storyIds, purpose) {
      if (!anthropic) throw new Error("clustering needs an Anthropic client");
      // assignClusters reads the given ids in one query, so large runs go in slices.
      for (let i = 0; i < storyIds.length; i += 200) await assignClusters(client, anthropic, storyIds.slice(i, i + 200), purpose);
    },

    async runDateRange(runId) {
      const first = rows(await client.from("news_stories").select("story_date").eq("run_id", runId).order("story_date").limit(1));
      const last = rows(
        await client.from("news_stories").select("story_date").eq("run_id", runId).order("story_date", { ascending: false }).limit(1),
      );
      return first.length ? { from: first[0].story_date, to: last[0].story_date } : null;
    },

    async refreshTrends(from, to) {
      check(await client.rpc("news_refresh_trends", { p_from: from, p_to: to }));
    },

    async emptyCleanIssues() {
      const out: { id: string; rawPath: string }[] = [];
      for (let from = 0; ; from += PAGE) {
        const page = rows(
          await client.from("news_issues").select("id, raw_path").eq("clean_text", "").neq("raw_path", "").order("id").range(from, from + PAGE - 1),
        );
        out.push(...page.map((r: { id: string; raw_path: string }) => ({ id: r.id, rawPath: r.raw_path })));
        if (page.length < PAGE) break;
      }
      return out;
    },

    async setCleanText(id, text) {
      check(await client.from("news_issues").update({ clean_text: text }).eq("id", id).eq("clean_text", ""));
    },
  };
}
