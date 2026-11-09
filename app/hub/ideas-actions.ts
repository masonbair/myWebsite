"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { isItemId } from "@/lib/hub/format";
import { masonStore } from "@/lib/hub/mason-store";
import type { HubStore, Item } from "@/lib/hub/types";
import { MEMO_FILE } from "@/lib/hub/memo";
import { disconnectFromGoogle, GoogleError, SETTINGS_PATH } from "@/lib/ideas/google";
import { IDEA_LABEL, isIdea } from "@/lib/ideas/read";
import { MAX_REVIEW_NOTE, recordingFile } from "@/lib/ideas/types";
import { serviceClient, sessionClient } from "@/lib/supabase/server";

const REVIEW_RUNNING = "A review is running. Try again in a few minutes.";

// Every action re-checks the owner: actions are reachable by POST without the (owner) layout running.
async function ownerIdea(id: unknown): Promise<{ store: HubStore; item: Item; id: string }> {
  await requireOwner();
  if (!isItemId(id)) throw new Error("bad item id");
  const store = await masonStore();
  const item = await store.getItem(id);
  if (!item) throw new Error("no such item");
  // Without this a crafted POST could enroll any todo item into a paid review.
  if (!isIdea(item)) throw new Error("not an idea");
  return { store, item, id };
}

function assertOpen(item: Item): void {
  if (item.state !== "open") throw new Error("only an open idea can change");
}

class ReviewRunning extends Error {
  constructor() {
    super(REVIEW_RUNNING);
  }
}

/** Updates the idea's settings row, inserting it when an older idea has none yet. */
async function writeSettings(id: string, columns: Record<string, unknown>): Promise<void> {
  const client = await sessionClient();
  const { data, error } = await client.from("idea_settings").update(columns).eq("item_id", id).select("item_id");
  // The database refuses changes that leave a claim under 30 minutes old while it is still working.
  if (error && /a review is running/.test(String(error.message))) throw new ReviewRunning();
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
    if (error instanceof ReviewRunning) return { error: REVIEW_RUNNING };
    throw error;
  }
  refreshHub();
  return { error: null };
}

/** Mason's call: the idea becomes a task on the Todo list, keeps the idea label so the Promoted filter finds it, and stops coming back. */
export async function promoteIdea(id: string): Promise<void> {
  const { store, item } = await ownerIdea(id);
  assertOpen(item);
  if (item.list === "todo") throw new Error("this idea is already a task");
  await writeSettings(item.id, stopColumns());
  const labels = item.labels.includes(IDEA_LABEL) ? item.labels : [...item.labels, IDEA_LABEL];
  await store.updateItem(item.id, { list: "todo", labels });
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
  await writeSettings(item.id, stopColumns());
  await store.updateItem(item.id, { list: "inbox", labels: item.labels.filter((label) => label !== IDEA_LABEL) });
  refreshHub();
}

/**
 * Puts a failed detection back in line; the saved detection is kept, so the retry files from it without a second Claude call.
 * @param ref the source item's id, or `rec:<file>` for a HiNote recording.
 */
export async function retryDetection(ref: string): Promise<void> {
  await requireOwner();
  const file = typeof ref === "string" ? recordingFile(ref) : null;
  if (file === null ? !isItemId(ref) : !MEMO_FILE.test(file)) throw new Error("bad source");
  const [table, key, value] = file === null ? (["idea_sources", "source_item_id", ref] as const) : (["idea_recordings", "file", file] as const);
  // The owner has no write grant on either table; the service client may, and only a failed row changes.
  const { data, error } = await serviceClient()
    .from(table)
    .update({ status: "pending", attempts: 0, last_error: null })
    .eq(key, value)
    .eq("status", "failed")
    .select(key);
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error("only a failed detection can be tried again");
  refreshHub();
}

/** Revokes the Google token, blanks it in Vault and marks Google disconnected; the Ideas calendar stays in Mason's account. */
export async function disconnectGoogle(): Promise<void> {
  await requireOwner();
  let revokeFailed = false;
  try {
    await disconnectFromGoogle(serviceClient(), (input, init) => fetch(input, init));
  } catch (error) {
    if (!(error instanceof GoogleError && error.step === "revoke")) throw error;
    revokeFailed = true;
  }
  revalidatePath(SETTINGS_PATH);
  // redirect() throws, so it stays outside the try.
  if (revokeFailed) redirect(`${SETTINGS_PATH}?google=revoke-failed`);
}
