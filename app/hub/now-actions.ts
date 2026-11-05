"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { NowInputError, parseBakeInput, placeRowWithPrivacy } from "@/lib/hub/now-input";
import { loadNow } from "@/lib/now";
import { sessionClient } from "@/lib/supabase/server";

export type NowActionResult = { ok: true } | { ok: false; error: string };

// The board keeps its hourly cache otherwise, so a change shows on the site right away only through this.
function refreshNow() {
  revalidatePath("/");
  revalidatePath("/hub/now");
}

export async function logBakeAction(raw: { name?: unknown; photo?: unknown; bakedAt?: unknown }): Promise<NowActionResult> {
  await requireOwner();
  let bake;
  try {
    bake = parseBakeInput(raw ?? {}, new Date());
  } catch (e) {
    if (e instanceof NowInputError) return { ok: false, error: e.message };
    throw e;
  }
  const { error } = await (await sessionClient())
    .from("now_bake")
    .insert({ name: bake.name, photo: bake.photo, baked_at: bake.bakedAt });
  if (error) return { ok: false, error: "Could not save the bake. Try again." };
  refreshNow();
  return { ok: true };
}

/** Writes a new place row copying the current place with the private flag set; a repeat with the same value does nothing. */
export async function setPlacePrivateAction(makePrivate: boolean): Promise<NowActionResult> {
  await requireOwner();
  if (typeof makePrivate !== "boolean") return { ok: false, error: "Bad request." };
  const { place } = await loadNow();
  if (!place) return { ok: false, error: "There is no place to change yet." };
  if (place.private === makePrivate) return { ok: true };
  const { error } = await (await sessionClient()).from("now_place").insert(placeRowWithPrivacy(place, makePrivate));
  if (error) return { ok: false, error: "Could not save. Try again." };
  refreshNow();
  return { ok: true };
}
