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

const SOURCE_ID = /^[a-z0-9-]{2,40}$/;

/** Sends a held-back email on to be read as the picked newsletter; the database function refuses everyone but the owner. */
export async function releaseIssue(id: string, sourceId: string): Promise<NewsActionResult> {
  await requireOwner();
  if (!isSameOriginHeaders(await headers()) || typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Bad request." };
  if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId) || sourceId === "shared") return { ok: false, error: "Pick a newsletter." };
  const client = await sessionClient();
  const { data: source, error: sourceError } = await client.from("news_sources").select("id").eq("id", sourceId).maybeSingle();
  if (sourceError) return { ok: false, error: "Could not release. Try again." };
  if (!source) return { ok: false, error: "Pick a newsletter." };
  const { data, error } = await client.rpc("news_release_issue", { p_id: id, p_source: sourceId });
  if (error) return { ok: false, error: "Could not release. Try again." };
  if (data !== true) return { ok: false, error: "Only held-back mail with no other newsletter can be released." };
  revalidatePath("/hub/news");
  return { ok: true };
}
