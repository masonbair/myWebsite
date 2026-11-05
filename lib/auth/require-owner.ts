import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";
import { isOwnerUser } from "./owner";

export type OwnerCheck = { ok: true; userId: string } | { ok: false; reason: "signed-out" | "not-owner" };

/** Checks the session belongs to Mason without redirecting, for route handlers that answer in their own way. */
export async function checkOwner(): Promise<OwnerCheck> {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, reason: "signed-out" };
  if (!isOwnerUser(data.user)) return { ok: false, reason: "not-owner" };
  const owner = await supabase.rpc("is_owner");
  if (owner.error || owner.data !== true) return { ok: false, reason: "not-owner" };
  return { ok: true, userId: data.user.id };
}

/** Gate for every /hub page: signed out goes to login, anyone but Mason gets a 404. */
export async function requireOwner(): Promise<{ userId: string }> {
  const check = await checkOwner();
  if (!check.ok && check.reason === "signed-out") redirect("/hub/login");
  if (!check.ok) notFound();
  return { userId: check.userId };
}

/** Adds Mason's Supabase user to hub_owner; safe to repeat on every sign-in. */
export async function recordOwner(service: SupabaseClient, userId: string): Promise<void> {
  const { error } = await service
    .from("hub_owner")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new Error(`could not record hub owner: ${error.message}`);
}
