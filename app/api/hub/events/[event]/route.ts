import { createSnapshotSource, runBackup, vercelBlobs } from "@/lib/hub/backup";
import { handleEventRequest, readLatestPlaceZone } from "@/lib/hub/events";
import { createHubStore } from "@/lib/hub/store";
import { ideasRunner } from "@/lib/ideas/runner";
import { serviceClient } from "@/lib/supabase/server";

// The ideas run (lib/ideas/runner.ts) stops starting reviews 90 seconds before its 270-second budget, inside this limit.
export const maxDuration = 300;

// Called by pg_cron and the items trigger through pg_net; the service role still cannot complete or delete anything.
export async function POST(request: Request, ctx: { params: Promise<{ event: string }> }) {
  const { event } = await ctx.params;
  const routineUrl = process.env.ROUTINE_FIRE_URL;
  const routineToken = process.env.ROUTINE_FIRE_TOKEN;
  return handleEventRequest(request, event, {
    token: process.env.HUB_EVENTS_TOKEN,
    store: () => createHubStore(serviceClient(), { kind: "worker", runId: "events" }),
    now: () => new Date(),
    timeZone: process.env.HUB_TIME_ZONE || undefined,
    latestPlaceZone: () => readLatestPlaceZone(serviceClient()),
    ntfyTopic: process.env.NTFY_TOPIC,
    routine: routineUrl && routineToken ? { url: routineUrl, token: routineToken } : null,
    fetchFn: fetch,
    backup: process.env.BLOB_STORE_ID
      ? () => runBackup({ source: createSnapshotSource(serviceClient()), blobs: vercelBlobs(), now: new Date() })
      : null,
    ideas: ideasRunner(),
  });
}
