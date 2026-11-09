import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHubStore } from "@/lib/hub/store";
import type { ResurfaceIdea, ResurfaceRow, ResurfaceStore } from "./resurface-step";
import { IDEAS_ACTOR } from "./store";
import type { IdeaReview } from "./types";

type RowRecord = {
  id: number;
  item_id: string;
  step: 1 | 2 | 3;
  due_date: string;
  event_date: string | null;
  google_event_id: string | null;
  status: ResurfaceRow["status"];
};

const toRow = (r: RowRecord): ResurfaceRow => ({
  id: r.id,
  itemId: r.item_id,
  step: r.step,
  dueDate: r.due_date,
  eventDate: r.event_date,
  googleEventId: r.google_event_id,
  status: r.status,
});

const ROW_COLUMNS = "id, item_id, step, due_date, event_date, google_event_id, status";
const PAGE = 1000;
// Ids travel in the URL, so ask in batches that stay well under URL length limits.
const ID_BATCH = 100;
const REVIEW_READS_AT_ONCE = 10;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Every row a ranged query matches; the hosted max_rows may cut a page short, so only an empty page ends it. */
async function allRows<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) return out;
    out.push(...data);
    from += data.length;
  }
}

async function inBatches<T>(ids: string[], read: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < ids.length; start += ID_BATCH) out.push(...(await read(ids.slice(start, start + ID_BATCH))));
  return out;
}

type ItemRecord = { id: string; title: string; state: ResurfaceIdea["state"]; list: string };
type SettingsRecord = { item_id: string; enrolled: boolean; schedule_from: string | null; reminders_stopped_at: string | null };

/** The resurface step's store over the service client. */
export function createResurfaceStore(client: SupabaseClient): ResurfaceStore {
  const hub = createHubStore(client, IDEAS_ACTOR);

  const settingsOf = (ids: string[], enrolledOnly: boolean) =>
    inBatches(ids, (batch) =>
      allRows<SettingsRecord>((from, to) => {
        let query = client.from("idea_settings").select("item_id, enrolled, schedule_from, reminders_stopped_at").in("item_id", batch);
        if (enrolledOnly) query = query.eq("enrolled", true);
        return query.order("item_id").range(from, to);
      }),
    );

  async function latestReview(id: string): Promise<IdeaReview | null> {
    const { data, error } = await client
      .from("idea_reviews")
      .select("review")
      .eq("item_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as { review: IdeaReview } | null)?.review ?? null;
  }

  return {
    async load(today) {
      // Active candidates are open ideas; anything else matters only while it still has a planned or upcoming row to close.
      const [openItems, openRows] = await Promise.all([
        allRows<ItemRecord>((from, to) =>
          client.from("items").select("id, title, state, list").eq("list", "ideas").eq("state", "open").order("id").range(from, to),
        ),
        allRows<RowRecord>((from, to) =>
          client.from("idea_resurface").select(ROW_COLUMNS).or(`status.eq.planned,event_date.gte.${today}`).order("id").range(from, to),
        ),
      ]);
      const itemById = new Map(openItems.map((i) => [i.id, i]));
      const enrolled = await settingsOf([...itemById.keys()], true);
      const activeIds = enrolled.map((s) => s.item_id);
      const active = new Set(activeIds);
      const closingIds = [...new Set(openRows.map((r) => r.item_id))].filter((id) => !active.has(id));
      const [closingSettings, closingItems, activeRows] = await Promise.all([
        settingsOf(closingIds, false),
        inBatches(closingIds, (batch) =>
          allRows<ItemRecord>((from, to) => client.from("items").select("id, title, state, list").in("id", batch).order("id").range(from, to)),
        ),
        // An active idea's past rows say which step comes next, so all of its rows are read.
        inBatches(activeIds, (batch) =>
          allRows<RowRecord>((from, to) => client.from("idea_resurface").select(ROW_COLUMNS).in("item_id", batch).order("id").range(from, to)),
        ),
      ]);
      for (const item of closingItems) itemById.set(item.id, item);

      const reviews = new Map<string, IdeaReview | null>();
      for (let start = 0; start < activeIds.length; start += REVIEW_READS_AT_ONCE) {
        const batch = activeIds.slice(start, start + REVIEW_READS_AT_ONCE);
        const found = await Promise.all(batch.map(latestReview));
        batch.forEach((id, n) => reviews.set(id, found[n]));
      }

      const ideas = [...enrolled, ...closingSettings].flatMap((s): ResurfaceIdea[] => {
        const item = itemById.get(s.item_id);
        if (!item) return [];
        const review = reviews.get(s.item_id) ?? null;
        return [
          {
            id: item.id,
            title: item.title,
            state: item.state,
            list: item.list,
            enrolled: s.enrolled,
            scheduleFrom: s.schedule_from,
            remindersStopped: s.reminders_stopped_at !== null,
            verdict: review?.verdict ?? null,
            why: review?.why ?? null,
            weekend: review?.weekend?.build ?? null,
          },
        ];
      });
      const rows = new Map([...openRows, ...activeRows].map((r) => [r.id, r]));
      return { ideas, rows: [...rows.values()].sort((a, b) => a.id - b.id).map(toRow) };
    },

    async planRow(itemId, step, dueDate) {
      const { data, error } = await client
        .from("idea_resurface")
        .upsert({ item_id: itemId, step, due_date: dueDate, status: "planned" }, { onConflict: "item_id,step,due_date", ignoreDuplicates: true })
        .select(ROW_COLUMNS);
      if (error) throw error;
      const row = (data as RowRecord[] | null)?.[0];
      return row ? toRow(row) : null;
    },

    async updateRow(id, columns) {
      const patch: Record<string, unknown> = {};
      if (columns.status !== undefined) patch.status = columns.status;
      if (columns.eventDate !== undefined) patch.event_date = columns.eventDate;
      if (columns.googleEventId !== undefined) patch.google_event_id = columns.googleEventId;
      const { error } = await client.from("idea_resurface").update(patch).eq("id", id);
      if (error) throw error;
    },

    async disconnectGoogle(forgetCalendar) {
      const columns: Record<string, unknown> = { connected: false, disconnected_at: new Date().toISOString() };
      if (forgetCalendar) columns.calendar_id = null;
      const { error } = await client.from("idea_google").update(columns).eq("id", true);
      if (error) throw error;
    },

    getFlag: (key) => hub.getHubState(key),
    setFlag: (key, value) => hub.setHubState(key, value),
  };
}
