"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { isItemId } from "@/lib/hub/format";
import { masonStore } from "@/lib/hub/mason-store";
import type { HubStore, Item } from "@/lib/hub/types";
import { IDEA_LABEL } from "@/lib/ideas/read";
import { MAX_REVIEW_NOTE } from "@/lib/ideas/types";
import { sessionClient } from "@/lib/supabase/server";

const REVIEW_RUNNING = "A review is running. Try again in a few minutes.";

// Every action re-checks the owner: actions are reachable by POST without the (owner) layout running.
async function ownerIdea(id: unknown): Promise<{ store: HubStore; item: Item; id: string }> {
  await requireOwner();
  if (!isItemId(id)) throw new Error("bad item id");
  const store = await masonStore();
  const item = await store.getItem(id);
  if (!item) throw new Error("no such item");
  return { store, item, id };
}

function assertOpen(item: Item): void {
  if (item.state !== "open") throw new Error("only an open idea can change");
}

/** Updates the idea's settings row, inserting it when an older idea has none yet. */
async function writeSettings(id: string, columns: Record<string, unknown>): Promise<void> {
  const client = await sessionClient();
  const { data, error } = await client.from("idea_settings").update(columns).eq("item_id", id).select("item_id");
  if (error) throw error;
  if ((data ?? []).length > 0) return;
  const { error: insertError } = await client.from("idea_settings").insert({ item_id: id, ...columns });
  if (insertError) throw insertError;
}

function refreshHub() {
  revalidatePath("/hub", "layout");
}

const stopColumns = () => ({ reminders_stopped_at: new Date().toISOString() });

/** Queues a fresh review and restarts the return schedule from today; the job closes the old planned returns. */
export async function requestReview(id: string, note: string): Promise<{ error: string | null }> {
  const { item } = await ownerIdea(id);
  if (typeof note !== "string") throw new Error("a review note must be text");
  const text = note.trim();
  if (text.length > MAX_REVIEW_NOTE) throw new Error(`a review note can be at most ${MAX_REVIEW_NOTE} characters`);
  assertOpen(item);
  try {
    await writeSettings(item.id, {
      enrolled: true,
      schedule_from: new Date().toISOString().slice(0, 10),
      review_status: "waiting",
      review_requested_at: new Date().toISOString(),
      review_note: text || null,
    });
  } catch (error) {
    // The database refuses to re-queue while a claim under 30 minutes old is still working.
    if (/a review is running/.test(String((error as { message?: unknown } | null)?.message))) {
      return { error: REVIEW_RUNNING };
    }
    throw error;
  }
  refreshHub();
  return { error: null };
}

/** Mason's call: the idea becomes a task on the Todo list and stops coming back. */
export async function promoteIdea(id: string): Promise<void> {
  const { store, item } = await ownerIdea(id);
  assertOpen(item);
  await store.updateItem(item.id, { list: "todo" });
  await writeSettings(item.id, stopColumns());
  refreshHub();
}

export async function stopReminders(id: string): Promise<void> {
  const { item } = await ownerIdea(id);
  await writeSettings(item.id, stopColumns());
  refreshHub();
}

export async function setNoWebSearch(id: string, on: boolean): Promise<void> {
  const { item } = await ownerIdea(id);
  if (typeof on !== "boolean") throw new Error("web search must be on or off");
  await writeSettings(item.id, { no_web_search: on });
  refreshHub();
}

/** Undoes the job moving a capture into Ideas: back to the inbox, no idea label, never resurfaced. */
export async function backToInbox(id: string): Promise<void> {
  const { store, item } = await ownerIdea(id);
  assertOpen(item);
  const { data, error } = await (await sessionClient())
    .from("idea_settings")
    .select("moved_from_inbox")
    .eq("item_id", item.id)
    .maybeSingle();
  if (error) throw error;
  if ((data as { moved_from_inbox?: boolean } | null)?.moved_from_inbox !== true) {
    throw new Error("only an idea moved from the inbox can go back to the inbox");
  }
  await store.updateItem(item.id, { list: "inbox", labels: item.labels.filter((label) => label !== IDEA_LABEL) });
  await writeSettings(item.id, stopColumns());
  refreshHub();
}
