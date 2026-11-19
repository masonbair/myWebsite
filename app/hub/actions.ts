"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { itemBrief } from "@/lib/hub/brief";
import { fireRoutine, masonTimeZone } from "@/lib/hub/events";
import { isItemId } from "@/lib/hub/format";
import { MAX_COMMENT, parseItemPatch } from "@/lib/hub/input";
import { masonStore } from "@/lib/hub/mason-store";
import { CLAUDE_LABEL } from "@/lib/hub/rules";
import type { ItemPatch } from "@/lib/hub/types";
import { sessionClient } from "@/lib/supabase/server";

// Every action re-checks the owner: actions are reachable by POST without the (owner) layout running.
async function ownerStoreFor(id: unknown) {
  await requireOwner();
  if (!isItemId(id)) throw new Error("bad item id");
  return masonStore();
}

const WORKER_OFF = "the worker is not live yet";

function workerLive(): boolean {
  return process.env.HUB_WORKER_LIVE === "true";
}

function refreshHub() {
  revalidatePath("/hub", "layout");
}

export async function completeItem(id: string): Promise<void> {
  await (await ownerStoreFor(id)).complete(id);
  refreshHub();
}

export async function reopenItem(id: string): Promise<void> {
  await (await ownerStoreFor(id)).reopen(id);
  refreshHub();
}

/** Hands an item to the worker by adding `claude`; refused unless the worker is live (Decision 6). */
export async function approveItem(id: string): Promise<void> {
  const store = await ownerStoreFor(id);
  if (!workerLive()) throw new Error(WORKER_OFF);
  const item = await store.getItem(id);
  if (!item || item.state !== "open") throw new Error("only an open item can be approved");
  if (!item.labels.includes(CLAUDE_LABEL)) {
    await store.updateItem(id, { labels: [...item.labels, CLAUDE_LABEL] });
    await startWorker(id);
  }
  refreshHub();
}

// Fired from here, not a database trigger: pg_net's lone calls failed with HTTP/2 framing errors and never retried.
async function startWorker(id: string): Promise<void> {
  const url = process.env.ROUTINE_FIRE_URL;
  const token = process.env.ROUTINE_FIRE_TOKEN;
  if (!url || !token) return;
  try {
    await fireRoutine(id, { url, token }, fetch);
  } catch (e) {
    console.error(`approve ${id}: worker not started now (${(e as Error).message}); the next scheduled run takes it`);
  }
}

export async function updateItemAction(id: string, patch: ItemPatch): Promise<void> {
  const store = await ownerStoreFor(id);
  const item = await store.getItem(id);
  if (!item) throw new Error("no such item");
  const clean = parseItemPatch(patch, item.labels);
  // Typing `claude` in the label editor is an approval too, so it needs the same gate as approveItem.
  const addsClaude = clean.labels?.includes(CLAUDE_LABEL) && !item.labels.includes(CLAUDE_LABEL);
  if (addsClaude && !workerLive()) throw new Error(WORKER_OFF);
  await store.updateItem(id, clean);
  if (addsClaude) await startWorker(id);
  refreshHub();
}

export async function addCommentAction(id: string, body: string): Promise<void> {
  const store = await ownerStoreFor(id);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text || text.length > MAX_COMMENT) throw new Error("a comment needs text");
  await store.addComment(id, text);
  refreshHub();
}

/** The item and all its comments as a brief to paste into a Claude session. */
export async function itemBriefAction(id: string): Promise<string> {
  const store = await ownerStoreFor(id);
  const [item, comments, timeZone] = await Promise.all([
    store.getItem(id),
    store.listComments(id),
    sessionClient().then((client) => masonTimeZone(client)),
  ]);
  if (!item) throw new Error("no such item");
  return itemBrief(item, comments, timeZone);
}

/** Ends only this browser's session, so Mason stays signed in on his other devices. */
export async function signOut(): Promise<void> {
  await (await sessionClient()).auth.signOut({ scope: "local" });
  redirect("/hub/login");
}
