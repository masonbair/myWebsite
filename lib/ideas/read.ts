import type { SupabaseClient } from "@supabase/supabase-js";
import { createHubStore } from "@/lib/hub/store";
import type { Comment, HubStore, Item } from "@/lib/hub/types";
import { REVIEW_SCHEMA, type IdeaReview, type ReviewStatus } from "./types";

export const IDEA_LABEL = "idea";
export const IDEA_FILTERS = ["active", "stopped", "promoted", "done"] as const;
export type IdeaFilter = (typeof IDEA_FILTERS)[number];

const LIST_LIMIT = 200;

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

async function settingsFor(client: SupabaseClient, ids: string[]): Promise<Map<string, SettingsRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client.from("idea_settings").select("*").in("item_id", ids);
  if (error) throw error;
  return new Map((data as SettingsRow[]).map((row) => [row.item_id, row]));
}

async function latestVerdicts(client: SupabaseClient, ids: string[]): Promise<Map<string, IdeaReview["verdict"] | null>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from("idea_reviews")
    .select("item_id, version, review->>verdict")
    .in("item_id", ids)
    .order("version", { ascending: false });
  if (error) throw error;
  const verdicts = new Map<string, IdeaReview["verdict"] | null>();
  const allowed = REVIEW_SCHEMA.shape.verdict;
  for (const row of data as { item_id: string; verdict: unknown }[]) {
    if (verdicts.has(row.item_id)) continue;
    const verdict = allowed.safeParse(row.verdict);
    verdicts.set(row.item_id, verdict.success ? verdict.data : null);
  }
  return verdicts;
}

async function nextReturns(client: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from("idea_resurface")
    .select("item_id, due_date")
    .in("item_id", ids)
    .eq("status", "planned")
    .order("due_date", { ascending: true });
  if (error) throw error;
  const next = new Map<string, string>();
  for (const row of data as { item_id: string; due_date: string }[]) {
    if (!next.has(row.item_id)) next.set(row.item_id, row.due_date);
  }
  return next;
}

async function itemsFor(store: HubStore, filter: IdeaFilter): Promise<Item[]> {
  switch (filter) {
    case "active":
    case "stopped":
      return store.listItems({ list: "ideas", state: "open", limit: LIST_LIMIT });
    case "promoted":
      return store.listItems({ list: "todo", state: "open", withLabels: [IDEA_LABEL], limit: LIST_LIMIT });
    case "done": {
      const [inIdeas, labelled] = await Promise.all([
        store.listItems({ list: "ideas", state: "done", limit: LIST_LIMIT }),
        store.listItems({ state: "done", withLabels: [IDEA_LABEL], limit: LIST_LIMIT }),
      ]);
      const byId = new Map([...inIdeas, ...labelled].map((item) => [item.id, item]));
      return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, LIST_LIMIT);
    }
  }
}

/** Ideas for one filter of the Ideas Lab list, newest first; works with the owner session or the service client. */
export async function listIdeas(client: SupabaseClient, filter: IdeaFilter): Promise<IdeaListRow[]> {
  let items = await itemsFor(readStore(client), filter);
  const settings = await settingsFor(client, items.map((i) => i.id));
  if (filter === "active") items = items.filter((i) => !settings.get(i.id)?.reminders_stopped_at);
  if (filter === "stopped") items = items.filter((i) => Boolean(settings.get(i.id)?.reminders_stopped_at));
  const ids = items.map((i) => i.id);
  const [verdicts, returns] = await Promise.all([latestVerdicts(client, ids), nextReturns(client, ids)]);
  return items.map((item) => {
    const row = settings.get(item.id);
    return {
      id: item.id,
      title: item.title,
      verdict: verdicts.get(item.id) ?? null,
      createdAt: item.createdAt,
      mentions: row?.mention_count ?? 1,
      nextReturn: returns.get(item.id) ?? null,
      reviewStatus: row?.review_status ?? "none",
    };
  });
}

// Quotes are stored per source either as plain strings in idea order or as { ideaId, quote } objects.
function quoteFor(quotes: unknown, ideaIds: string[], id: string): string | null {
  if (!Array.isArray(quotes)) return null;
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
  if (!item) return null;
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
