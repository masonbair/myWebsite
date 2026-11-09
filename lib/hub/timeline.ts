import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isCalendarDate } from "./input";
import { auditActor, ForbiddenError } from "./rules";
import type { Actor } from "./types";

export const MAX_PROJECT_NAME = 80;
export const MAX_SUMMARY = 4000;
const MAX_PROJECTS_PER_DAY = 40;
const MAX_BRANCHES = 50;
const DAY_MS = 86_400_000;

const projectEntry = z.object({
  project: z.string().trim().min(1).max(MAX_PROJECT_NAME).describe("The project's folder or repo name"),
  summary: z.string().trim().min(1).max(MAX_SUMMARY).describe("A few plain sentences anyone could follow about what got done"),
  commits: z.number().int().min(0).max(100_000).describe("Commits made that day, across all branches"),
  branches: z.array(z.string().trim().min(1).max(200)).max(MAX_BRANCHES).describe("Branches that got commits that day"),
});

export const timelineDayInput = z.object({
  day: z.string().refine(isCalendarDate, "day must be a real YYYY-MM-DD date").describe("Mason's local calendar day the work happened"),
  projects: z
    .array(projectEntry)
    .min(1)
    .max(MAX_PROJECTS_PER_DAY)
    .refine((list) => new Set(list.map((p) => p.project)).size === list.length, "each project may appear once per day"),
});

export type TimelineDayInput = z.infer<typeof timelineDayInput>;

export type TimelineEntry = {
  day: string;
  project: string;
  summary: string;
  commits: number;
  branches: string[];
  updatedAt: string;
};

export type TimelineDay = { day: string; entries: TimelineEntry[] };

export type TimelineWriter = { logDay(input: TimelineDayInput): Promise<TimelineEntry[]> };

type EntryRow = {
  day: string;
  project: string;
  summary: string;
  commits: number;
  branches: string[];
  updated_at: string;
};

function toEntry(row: EntryRow): TimelineEntry {
  return { day: row.day, project: row.project, summary: row.summary, commits: row.commits, branches: row.branches, updatedAt: row.updated_at };
}

/** Agents may write from two days before today (UTC) to one day after, so every time zone's today and yesterday fit. */
export function isOpenDay(day: string, now: Date): boolean {
  const target = Date.parse(`${day}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return target >= today - 2 * DAY_MS && target <= today + DAY_MS;
}

/** Writes one day's project summaries for an agent; sending a project again replaces that day's text for it. */
export function timelineWriter(client: SupabaseClient, actor: Actor, now: () => Date = () => new Date()): TimelineWriter {
  return {
    async logDay(input) {
      if (!isOpenDay(input.day, now())) throw new ForbiddenError(`timeline day ${input.day} is closed`);
      const writer = auditActor(actor);
      const rows = input.projects.map((p) => ({
        day: input.day,
        project: p.project,
        summary: p.summary,
        commits: p.commits,
        branches: p.branches,
        updated_by: writer,
        updated_at: now().toISOString(),
      }));
      const { data, error } = await client.from("timeline_entries").upsert(rows, { onConflict: "day,project" }).select("*");
      if (error) throw error;
      const { error: auditError } = await client
        .from("audit_log")
        .insert({ actor: writer, action: "timeline", item_id: null, detail: { day: input.day, projects: rows.map((r) => r.project) } });
      if (auditError) throw auditError;
      return (data as EntryRow[]).map(toEntry).sort((a, b) => a.project.localeCompare(b.project));
    },
  };
}

/** The newest days first, each with its projects in name order. */
export async function listTimeline(client: SupabaseClient, days = 60): Promise<TimelineDay[]> {
  const { data, error } = await client
    .from("timeline_entries")
    .select("day, project, summary, commits, branches, updated_at")
    .order("day", { ascending: false })
    .order("project", { ascending: true })
    .limit(days * MAX_PROJECTS_PER_DAY);
  if (error) throw error;
  const byDay = new Map<string, TimelineEntry[]>();
  for (const row of data as EntryRow[]) {
    const entries = byDay.get(row.day) ?? [];
    entries.push(toEntry(row));
    byDay.set(row.day, entries);
  }
  return [...byDay].slice(0, days).map(([day, entries]) => ({ day, entries }));
}
