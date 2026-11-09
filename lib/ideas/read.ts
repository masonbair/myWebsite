import type { SupabaseClient } from "@supabase/supabase-js";
import { createHubStore } from "@/lib/hub/store";
import type { Comment, HubStore, Item } from "@/lib/hub/types";
import { REVIEW_SCHEMA, type IdeaReview, type ReviewStatus } from "./types";

export const IDEA_LABEL = "idea";
export const IDEA_FILTERS = ["active", "stopped", "promoted", "done"] as const;
export type IdeaFilter = (typeof IDEA_FILTERS)[number];

const LIST_LIMIT = 200;

/** An idea is anything on the Ideas list or carrying the idea label (a promoted idea keeps it). */
export function isIdea(item: Pick<Item, "list" | "labels">): boolean {
  return item.list === "ideas" || item.labels.includes(IDEA_LABEL);
}

export type IdeaListRow = {
  id: string;
  title: string;
  verdict: IdeaReview["verdict"] | null;
  createdAt: string;
  mentions: number;
  nextReturn: string | null;
  reviewStatus: ReviewStatus;
};

/** The idea_settings columns the pages show; null fields mean the idea has no settings row yet. */
export type IdeaPageSettings = {
  enrolled: boolean;
  noWebSearch: boolean;
  reviewStatus: ReviewStatus;
  remindersStoppedAt: string | null;
  scheduleFrom: string | null;
  movedFromInbox: boolean;
  mentionCount: number;
};

/** One saved review; `review` is null when the stored JSON no longer matches the schema. */
export type IdeaReviewVersion = {
  version: number;
  createdAt: string;
  note: string | null;
  review: IdeaReview | null;
};

export type IdeaSource = { itemId: string; title: string; kind: "capture" | "memo"; quote: string | null };

export type IdeaReturn = { step: number; dueDate: string; eventDate: string | null; status: "planned" | "sent" | "closed" | "skipped" };

export type IdeaPage = {
  item: Item;
  settings: IdeaPageSettings | null;
  /** Newest first. */
  reviews: IdeaReviewVersion[];
  source: IdeaSource | null;
  schedule: IdeaReturn[];
  comments: Comment[];
};

type SettingsRow = {
  item_id: string;
  enrolled: boolean;
  no_web_search: boolean;
  review_status: ReviewStatus;
  reminders_stopped_at: string | null;
  schedule_from: string | null;
  moved_from_inbox: boolean;
  mention_count: number;
};

type ReviewRow = { item_id: string; version: number; created_at: string; note: string | null; review: unknown };

function toSettings(row: SettingsRow): IdeaPageSettings {
  return {
    enrolled: row.enrolled,
    noWebSearch: row.no_web_search,
    reviewStatus: row.review_status,
    remindersStoppedAt: row.reminders_stopped_at,
    scheduleFrom: row.schedule_from,
    movedFromInbox: row.moved_from_inbox,
    mentionCount: row.mention_count,
  };
}

function parseReview(raw: unknown): IdeaReview | null {
  const parsed = REVIEW_SCHEMA.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Reads never write, so the actor only matters to the store's permission check, which allows reads for everyone.
function readStore(client: SupabaseClient): HubStore {
  return createHubStore(client, { kind: "mason" });
}

type ListRow = {
  id: string;
  title: string;
  created_at: string;
  settings: { mention_count: number; review_status: ReviewStatus } | { mention_count: number; review_status: ReviewStatus }[] | null;
  latest: { review: unknown }[];
  next: { due_date: string }[];
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// Typed as plain string so supabase-js skips parsing the select, which is too deep for tsc here.
const LIST_SELECT: string =
  "id, title, created_at, settings:idea_settings(mention_count, review_status), stopped:idea_settings(item_id), latest:idea_reviews(version, review), next:idea_resurface(due_date)";

// One query per filter: the stopped filter runs in the database and each embed keeps only the row the list needs, so no cap drops data silently.
function listQuery(client: SupabaseClient, filter: IdeaFilter) {
  let query = client
    .from("items")
    .select(LIST_SELECT, { count: "exact" })
    .order("version", { referencedTable: "latest", ascending: false })
    .limit(1, { referencedTable: "latest" })
    .eq("next.status", "planned")
    .order("due_date", { referencedTable: "next", ascending: true })
    .limit(1, { referencedTable: "next" })
    .not("stopped.reminders_stopped_at", "is", null);
  switch (filter) {
    case "active":
      query = query.eq("list", "ideas").eq("state", "open").filter("stopped", "is", null);
      break;
    case "stopped":
      query = query.eq("list", "ideas").eq("state", "open").filter("stopped", "not.is", null);
      break;
    case "promoted":
      query = query.eq("list", "todo").eq("state", "open").contains("labels", [IDEA_LABEL]);
      break;
    case "done":
      query = query.eq("state", "done").or(`list.eq.ideas,labels.cs.{${IDEA_LABEL}}`);
      break;
  }
  return query.order("created_at", { ascending: false }).limit(LIST_LIMIT);
}

export type IdeaList = { ideas: IdeaListRow[]; total: number };

/** A capture or memo the job could not read after three tries. */
export type FailedSource = { itemId: string; title: string; kind: "capture" | "memo" };

/** Sources whose detection failed, newest first, for the Ideas Lab's retry list; read with the owner session. */
export async function listFailedSources(client: SupabaseClient): Promise<FailedSource[]> {
  const { data, error } = await client
    .from("idea_sources")
    .select("source_item_id, kind")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as { source_item_id: string; kind: FailedSource["kind"] }[];
  if (rows.length === 0) return [];
  const { data: items, error: itemsError } = await client.from("items").select("id, title").in("id", rows.map((r) => r.source_item_id));
  if (itemsError) throw itemsError;
  const titles = new Map(((items ?? []) as { id: string; title: string }[]).map((i) => [i.id, i.title]));
  return rows.map((r) => ({ itemId: r.source_item_id, kind: r.kind, title: titles.get(r.source_item_id) ?? "Untitled" }));
}

/** Up to 200 ideas for one filter of the Ideas Lab list, newest first, plus how many match in all; works with the owner session or the service client. */
export async function listIdeas(client: SupabaseClient, filter: IdeaFilter): Promise<IdeaList> {
  const { data, error, count } = await listQuery(client, filter);
  if (error) throw error;
  const rows = data as unknown as ListRow[];
  const ideas = rows.map((row) => {
    const settings = one(row.settings);
    return {
      id: row.id,
      title: row.title,
      verdict: parseReview(row.latest[0]?.review)?.verdict ?? null,
      createdAt: row.created_at,
      mentions: settings?.mention_count ?? 1,
      nextReturn: row.next[0]?.due_date ?? null,
      reviewStatus: settings?.review_status ?? "none",
    };
  });
  return { ideas, total: count ?? ideas.length };
}

type QuoteEntry = { quote?: unknown; ideaId?: unknown; outcome?: { kind?: unknown; id?: unknown } | null };

// Detection saves { quote, outcome: { kind, id } } per idea; older rows hold plain strings in idea order or { ideaId, quote }.
function quoteFor(quotes: unknown, ideaIds: string[], id: string): string | null {
  if (!Array.isArray(quotes)) return null;
  const entries = (quotes as QuoteEntry[]).filter(
    (q) => typeof q === "object" && q !== null && q.outcome?.id === id && typeof q.quote === "string",
  );
  const saved = entries.find((q) => q.outcome?.kind !== "mention") ?? entries[0];
  if (saved) return saved.quote as string;
  const byObject = quotes.find(
    (q): q is { quote: string } =>
      typeof q === "object" && q !== null && (q as { ideaId?: unknown }).ideaId === id && typeof (q as { quote?: unknown }).quote === "string",
  );
  if (byObject) return byObject.quote;
  const positional = quotes[ideaIds.indexOf(id)];
  return typeof positional === "string" ? positional : null;
}

async function sourceFor(client: SupabaseClient, store: HubStore, id: string): Promise<IdeaSource | null> {
  const { data, error } = await client
    .from("idea_sources")
    .select("source_item_id, kind, idea_item_ids, quotes")
    .contains("idea_item_ids", [id])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { source_item_id: string; kind: IdeaSource["kind"]; idea_item_ids: string[]; quotes: unknown };
  if (row.source_item_id === id) return null;
  const sourceItem = await store.getItem(row.source_item_id);
  return {
    itemId: row.source_item_id,
    title: sourceItem?.title ?? "the original capture",
    kind: row.kind,
    quote: quoteFor(row.quotes, row.idea_item_ids, id),
  };
}

/** Everything the idea page shows, or null when there is no such item. */
export async function getIdeaPage(client: SupabaseClient, id: string): Promise<IdeaPage | null> {
  const store = readStore(client);
  const item = await store.getItem(id);
  if (!item || !isIdea(item)) return null;
  const [settings, reviews, schedule, source, comments] = await Promise.all([
    client.from("idea_settings").select("*").eq("item_id", id).maybeSingle(),
    client.from("idea_reviews").select("item_id, version, created_at, note, review").eq("item_id", id).order("version", { ascending: false }),
    client.from("idea_resurface").select("step, due_date, event_date, status").eq("item_id", id).order("due_date", { ascending: true }),
    sourceFor(client, store, id),
    store.listComments(id),
  ]);
  for (const result of [settings, reviews, schedule]) if (result.error) throw result.error;
  return {
    item,
    settings: settings.data ? toSettings(settings.data as SettingsRow) : null,
    reviews: (reviews.data as ReviewRow[]).map((row) => ({
      version: row.version,
      createdAt: row.created_at,
      note: row.note,
      review: parseReview(row.review),
    })),
    source,
    schedule: (schedule.data as { step: number; due_date: string; event_date: string | null; status: IdeaReturn["status"] }[]).map((row) => ({
      step: row.step,
      dueDate: row.due_date,
      eventDate: row.event_date,
      status: row.status,
    })),
    comments,
  };
}
