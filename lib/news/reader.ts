import type { SupabaseClient } from "@supabase/supabase-js";
import { capUsd } from "./budget";
import type { IssueStatus } from "./types";

export type IssueRow = { id: string; subject: string; receivedAt: string; status: IssueStatus; lastError: string | null };
export type SourceIssues = { sourceId: string; sourceName: string; issues: IssueRow[] };
export type QuarantinedRow = { id: string; from: string; subject: string; receivedAt: string };
export type Costs = { thisMonth: number; lastMonth: number; perIssue: number | null };

export type NewsOverview = {
  issues: SourceIssues[];
  quarantined: QuarantinedRow[];
  costThisMonth: number | null;
  costLastMonth: number | null;
  costPerIssue: number | null;
  cap: number;
  paused: boolean;
  suggestedTopics: { topic: string; count: number }[];
};

export type NewsOverviewDeps = {
  costs?: () => Promise<Costs>;
  pausedMonth?: () => Promise<string | null>;
};

const PER_SOURCE = 10;
const UNMATCHED = "unmatched";

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Everything the owner's news page shows, read with the owner's session so row security applies. */
export async function readNewsOverview(client: SupabaseClient, now: Date, deps: NewsOverviewDeps = {}): Promise<NewsOverview> {
  const [sources, issues, quarantined, stories, costs, pausedMonth] = await Promise.all([
    rows<{ id: string; name: string }>(client.from("news_sources").select("id, name")),
    rows<{ id: string; source_id: string | null; subject: string; received_at: string; status: IssueStatus; last_error: string | null }>(
      client
        .from("news_issues")
        .select("id, source_id, subject, received_at, status, last_error")
        .order("received_at", { ascending: false })
        .limit(300),
    ),
    rows<{ id: string; from_address: string; subject: string; received_at: string }>(
      client
        .from("news_issues")
        .select("id, from_address, subject, received_at")
        .eq("status", "quarantined")
        .order("received_at", { ascending: false })
        .limit(100),
    ),
    rows<{ suggested_topic: string | null }>(client.from("news_stories").select("suggested_topic").not("suggested_topic", "is", null).limit(2000)),
    deps.costs ? deps.costs().catch(() => null) : Promise.resolve(null),
    deps.pausedMonth ? deps.pausedMonth().catch(() => null) : Promise.resolve(null),
  ]);

  const names = new Map(sources.map((s) => [s.id, s.name]));
  const groups = new Map<string, SourceIssues>();
  for (const row of issues) {
    if (row.status === "quarantined") continue;
    const sourceId = row.source_id ?? UNMATCHED;
    let group = groups.get(sourceId);
    if (!group) {
      group = { sourceId, sourceName: names.get(sourceId) ?? "Unmatched sender", issues: [] };
      groups.set(sourceId, group);
    }
    if (group.issues.length < PER_SOURCE) {
      group.issues.push({ id: row.id, subject: row.subject, receivedAt: row.received_at, status: row.status, lastError: row.last_error });
    }
  }

  const counts = new Map<string, number>();
  for (const { suggested_topic } of stories) {
    if (suggested_topic) counts.set(suggested_topic, (counts.get(suggested_topic) ?? 0) + 1);
  }

  return {
    issues: [...groups.values()],
    quarantined: quarantined.map((r) => ({ id: r.id, from: r.from_address, subject: r.subject, receivedAt: r.received_at })),
    costThisMonth: costs?.thisMonth ?? null,
    costLastMonth: costs?.lastMonth ?? null,
    costPerIssue: costs?.perIssue ?? null,
    cap: capUsd(process.env),
    paused: pausedMonth === now.toISOString().slice(0, 7),
    suggestedTopics: [...counts].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)).slice(0, 20),
  };
}
