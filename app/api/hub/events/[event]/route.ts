import { anthropicClient, monthSpend } from "@/lib/ai/claude";
import { createSnapshotSource, runBackup, vercelBlobs } from "@/lib/hub/backup";
import { handleEventRequest, readLatestPlaceZone, reminderTimeZone } from "@/lib/hub/events";
import { notify, type Message } from "@/lib/hub/notify";
import { createHubStore } from "@/lib/hub/store";
import { googleFromVault } from "@/lib/ideas/google";
import { budgetFromEnv, runIdeasJob } from "@/lib/ideas/job";
import { runResurface } from "@/lib/ideas/resurface-step";
import { createResurfaceStore } from "@/lib/ideas/resurface-store";
import { createIdeasJobStore } from "@/lib/ideas/store";
import { serviceClient } from "@/lib/supabase/server";

// The ideas run stops starting reviews 90 seconds before its 270-second budget, inside this limit.
export const maxDuration = 300;
const IDEAS_DEADLINE_MS = 270_000;
const DEFAULT_TIME_ZONE = "America/Denver";

function ideasRunner() {
  const anthropic = anthropicClient("ideas");
  if (!anthropic) return null;
  const topic = process.env.NTFY_TOPIC;
  const ntfy = async (msg: Message) => {
    if (!topic) throw new Error("NTFY_TOPIC is not set");
    await notify(topic, msg);
  };
  return () => {
    const deadline = Date.now() + IDEAS_DEADLINE_MS;
    return runIdeasJob({
      store: createIdeasJobStore(serviceClient()),
      anthropic,
      now: () => new Date(),
      budgetUsd: budgetFromEnv(process.env.IDEAS_MONTHLY_BUDGET_USD),
      webSearchOff: process.env.IDEAS_WEB_SEARCH === "off",
      ntfy,
      deadlineMs: IDEAS_DEADLINE_MS,
      spend: async () => (await monthSpend(serviceClient(), "ideas", new Date())).thisMonth,
      resurface: () =>
        runResurface({
          store: createResurfaceStore(serviceClient()),
          google: () => googleFromVault(serviceClient(), fetch),
          timeZone: async () =>
            reminderTimeZone(await readLatestPlaceZone(serviceClient()), process.env.HUB_TIME_ZONE || DEFAULT_TIME_ZONE, new Date()),
          now: () => new Date(),
          deadline,
          ntfy,
        }),
    });
  };
}

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
