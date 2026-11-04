"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { isItemId } from "@/lib/hub/format";
import { MAX_COMMENT, parseItemPatch } from "@/lib/hub/input";
import { masonStore } from "@/lib/hub/mason-store";
import { CLAUDE_LABEL } from "@/lib/hub/rules";
import type { ItemPatch } from "@/lib/hub/types";

// Every action re-checks the owner: actions are reachable by POST without the (owner) layout running.
async function ownerStoreFor(id: unknown) {
  await requireOwner();
  if (!isItemId(id)) throw new Error("bad item id");
  return masonStore();
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
  if (process.env.HUB_WORKER_LIVE !== "true") throw new Error("the worker is not live yet");
  const item = await store.getItem(id);
  if (!item || item.state !== "open") throw new Error("only an open item can be approved");
  if (!item.labels.includes(CLAUDE_LABEL)) await store.updateItem(id, { labels: [...item.labels, CLAUDE_LABEL] });
  refreshHub();
}

export async function updateItemAction(id: string, patch: ItemPatch): Promise<void> {
  const store = await ownerStoreFor(id);
  await store.updateItem(id, parseItemPatch(patch));
  refreshHub();
}

export async function addCommentAction(id: string, body: string): Promise<void> {
  const store = await ownerStoreFor(id);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text || text.length > MAX_COMMENT) throw new Error("a comment needs text");
  await store.addComment(id, text);
  refreshHub();
}
