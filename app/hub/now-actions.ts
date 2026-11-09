"use server";

import { existsSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { NowInputError, parseBakeInput, privacyRow } from "@/lib/hub/now-input";
import { readNowRows, type NowRows } from "@/lib/now";
import { serviceClient, sessionClient } from "@/lib/supabase/server";

export type NowActionResult = { ok: true } | { ok: false; error: string };

// The board keeps its hourly cache otherwise, so a change shows on the site right away only through this.
function refreshNow() {
  revalidatePath("/");
  revalidatePath("/hub/now");
}

// parseBakeInput has already matched the /misc pattern, so the path cannot leave public/misc.
const photoExists = (src: string) => existsSync(path.join(process.cwd(), "public", src));

export async function logBakeAction(raw: { name?: unknown; photo?: unknown; bakedAt?: unknown }): Promise<NowActionResult> {
  await requireOwner();
  let bake;
  try {
    bake = parseBakeInput(raw ?? {}, new Date(), photoExists);
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

/** Marks the current database place private or public with a new privacy row, so later pings from the same place keep it. */
export async function setPlacePrivateAction(makePrivate: boolean): Promise<NowActionResult> {
  await requireOwner();
  if (typeof makePrivate !== "boolean") return { ok: false, error: "Bad request." };
  let rows: NowRows;
  try {
    rows = await readNowRows(serviceClient());
  } catch {
    return { ok: false, error: "Could not read the current place from the database. Nothing changed." };
  }
  const place = rows.place;
  if (!place) return { ok: false, error: "There is no place in the database yet, so there is nothing to mark." };
  if (place.private === makePrivate) return { ok: true };
  if (!makePrivate && place.sentPrivate) return { ok: false, error: "The phone sent this place as private, so it stays private." };
  const city = place.city;
  if (!city) return { ok: false, error: "This place has no city, so there is nothing to mark." };
  const { error } = await (await sessionClient()).from("now_place_privacy").insert(privacyRow({ ...place, city }, makePrivate));
  if (error) return { ok: false, error: "Could not save. Try again." };
  refreshNow();
  return { ok: true };
}
