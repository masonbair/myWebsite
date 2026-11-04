import "server-only";
import { sessionClient } from "@/lib/supabase/server";
import { createHubStore } from "./store";
import type { HubStore } from "./types";

/** Mason's store over his own session; the database only lets that role complete or reopen. Call requireOwner() first. */
export async function masonStore(): Promise<HubStore> {
  return createHubStore(await sessionClient(), { kind: "mason" });
}
