import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";
import { isOwnerUser } from "./owner";

/** Gate for every /hub page: signed out goes to login, anyone but Mason gets a 404. */
export async function requireOwner(): Promise<{ userId: string }> {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/hub/login");
  if (!isOwnerUser(data.user)) notFound();
  const owner = await supabase.rpc("is_owner");
  if (owner.error || owner.data !== true) notFound();
  return { userId: data.user.id };
}

/** Adds Mason's Supabase user to hub_owner; safe to repeat on every sign-in. */
export async function recordOwner(service: SupabaseClient, userId: string): Promise<void> {
  const { error } = await service
    .from("hub_owner")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new Error(`could not record hub owner: ${error.message}`);
}
