"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireOwner } from "@/lib/auth/require-owner";
import { isSameOriginHeaders } from "@/lib/auth/same-origin";
import { sessionClient } from "@/lib/supabase/server";

export type NewsActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Puts a failed issue back in the queue; the database function refuses everyone but the owner. */
export async function retryIssue(id: string): Promise<NewsActionResult> {
  await requireOwner();
  if (!isSameOriginHeaders(await headers()) || typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Bad request." };
  const { data, error } = await (await sessionClient()).rpc("news_retry", { p_id: id });
  if (error) return { ok: false, error: "Could not retry. Try again." };
  if (data !== true) return { ok: false, error: "Only an issue that failed can be retried." };
  revalidatePath("/hub/news");
  return { ok: true };
}
