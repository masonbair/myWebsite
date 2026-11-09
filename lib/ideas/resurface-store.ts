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

/** The resurface step's store over the service client. */
export function createResurfaceStore(client: SupabaseClient): ResurfaceStore {
  const hub = createHubStore(client, IDEAS_ACTOR);

  return {
    async ideas() {
      // Rows are only ever planned for enrolled ideas, so this also covers every idea with an open row.
      const { data: settings, error } = await client
        .from("idea_settings")
        .select("item_id, enrolled, schedule_from, reminders_stopped_at")
        .eq("enrolled", true);
      if (error) throw error;
      const ids = (settings ?? []).map((s) => s.item_id as string);
      if (!ids.length) return [];
      const [{ data: items, error: itemError }, { data: reviews, error: reviewError }] = await Promise.all([
        client.from("items").select("id, title, state, list").in("id", ids),
        client.from("idea_reviews").select("item_id, version, review").in("item_id", ids).order("version", { ascending: false }),
      ]);
      if (itemError) throw itemError;
      if (reviewError) throw reviewError;
      const latest = new Map<string, IdeaReview>();
      for (const r of reviews ?? []) if (!latest.has(r.item_id)) latest.set(r.item_id, r.review as IdeaReview);
      const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
      return (settings ?? []).flatMap((s): ResurfaceIdea[] => {
        const item = itemById.get(s.item_id);
        if (!item) return [];
        const review = latest.get(s.item_id);
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
    },

    async rows() {
      const { data, error } = await client
        .from("idea_resurface")
        .select("id, item_id, step, due_date, event_date, google_event_id, status")
        .order("id");
      if (error) throw error;
      return (data as RowRecord[]).map(toRow);
    },

    async planRow(itemId, step, dueDate) {
      const { data, error } = await client
        .from("idea_resurface")
        .upsert({ item_id: itemId, step, due_date: dueDate, status: "planned" }, { onConflict: "item_id,step,due_date", ignoreDuplicates: true })
        .select("id, item_id, step, due_date, event_date, google_event_id, status");
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
