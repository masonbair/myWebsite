import "server-only";
import { anthropicClient } from "@/lib/ai/claude";
import { DEFAULT_TIME_ZONE, masonTimeZone } from "@/lib/hub/events";
import { serviceClient } from "@/lib/supabase/server";
import type { AwardDeps } from "./award";
import { learnCapUsd } from "./budget";
import { learnToday } from "./day";
import { signingKey } from "./grant";
import { supabaseLearnStore, type LearnStore } from "./store";

/** Everything server code needs to save and grade an answer, built once per request from the environment. */
export async function learnRuntime(): Promise<{ store: LearnStore; today: string; awardDeps: AwardDeps }> {
  const client = serviceClient();
  const store = supabaseLearnStore(client);
  const timeZone = await masonTimeZone(client);
  const now = () => new Date();
  return {
    store,
    today: learnToday(now(), timeZone),
    awardDeps: {
      store,
      anthropic: anthropicClient("learn"),
      key: signingKey(process.env.LEARN_GRANT_PRIVATE_KEY),
      now,
      timeZone,
      defaultTimeZone: process.env.HUB_TIME_ZONE || DEFAULT_TIME_ZONE,
      cap: learnCapUsd(process.env),
    },
  };
}
