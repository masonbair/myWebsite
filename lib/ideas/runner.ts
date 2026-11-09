import "server-only";
import { anthropicClient, monthSpend } from "@/lib/ai/claude";
import { readLatestPlaceZone, reminderTimeZone } from "@/lib/hub/events";
import { notify, type Message } from "@/lib/hub/notify";
import { serviceClient } from "@/lib/supabase/server";
import { googleFromVault } from "./google";
import { budgetFromEnv, runIdeasJob } from "./job";
import { runResurface } from "./resurface-step";
import { createResurfaceStore } from "./resurface-store";
import { createIdeasJobStore } from "./store";

const IDEAS_DEADLINE_MS = 270_000;
const DEFAULT_TIME_ZONE = "America/Denver";

/** The ideas event's run over the service client; detection and review skip themselves without the Claude key. */
export function ideasRunner() {
  const anthropic = anthropicClient("ideas");
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
