import "server-only";
import { sessionClient } from "@/lib/supabase/server";
import type { CaptureText } from "./capture";
import { masonStore } from "./mason-store";
import type { Item } from "./types";

/** Adds a capture to Mason's inbox, or to Ideas when asIdea (the database trigger then enrolls it); `created` is false when the client key was seen before. Call checkOwner() first. */
export async function saveCapture(
  capture: CaptureText & { clientKey?: string },
  source: "capture" | "share",
  options: { asIdea?: boolean } = {},
): Promise<{ item: Item; created: boolean }> {
  // The store hands back the earlier item for a repeated key without saying so; this lookup tells the two apart.
  const seen = capture.clientKey
    ? await (await sessionClient()).from("items").select("id").eq("client_key", capture.clientKey).maybeSingle()
    : null;
  const item = await (await masonStore()).addItem({ ...capture, source, ...(options.asIdea && source === "capture" ? { list: "ideas", labels: ["idea"] } : { list: "inbox" }) });
  return { item, created: !seen?.data };
}
