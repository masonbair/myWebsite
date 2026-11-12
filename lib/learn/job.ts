import "server-only";
import type { KeyObject } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { gradeAndGrant, type AwardResult } from "./award";
import { dayPlan, learnToday } from "./day";
import { generateExercises } from "./generate";
import type { LearnStore } from "./store";

const RECENT_DAYS = 14;
const MAX_ATTEMPTS = 3;

export type LearnJobDeps = {
  store: LearnStore;
  anthropic: Anthropic | null;
  key: KeyObject | null;
  now: () => Date;
  timeZone: string;
  cap: number;
  fetchFn: typeof fetch;
  generate?: typeof generateExercises;
  award?: (answerId: string) => Promise<AwardResult>;
};

/** One run of the 15-minute learn event: write today's exercises if missing, then retry grading what is waiting. */
export async function runLearnJob(deps: LearnJobDeps): Promise<{ generated: boolean; graded: string[]; waiting: string[] }> {
  const { store } = deps;
  const today = learnToday(deps.now(), deps.timeZone);
  let generated = false;

  if (deps.anthropic && (await store.exercisesFor(today)).length === 0 && (await store.spend(deps.now())) < deps.cap) {
    try {
      const { rows, usage } = await (deps.generate ?? generateExercises)(
        deps.anthropic,
        today,
        dayPlan(today),
        await store.recentQuestions(RECENT_DAYS, today),
        deps.fetchFn,
      );
      for (const c of usage) await store.recordUsage({ model: c.model, itemId: null, purpose: "generate", usage: c.usage });
      generated = (await store.insertExercises(rows)) === "ok";
    } catch (e) {
      console.error(`learn: exercises not written: ${(e as Error).message}`);
    }
  }

  const award =
    deps.award ??
    ((id: string) =>
      gradeAndGrant({ store, anthropic: deps.anthropic, key: deps.key, now: deps.now, timeZone: deps.timeZone, cap: deps.cap }, id));
  const graded: string[] = [];
  const waiting: string[] = [];
  for (const id of await store.answersToRetry(MAX_ATTEMPTS)) {
    try {
      const result = await award(id);
      if (result.status === "graded") graded.push(id);
      else if (result.status === "waiting") waiting.push(id);
    } catch (e) {
      console.error(`learn: answer ${id} not graded: ${(e as Error).name}`);
    }
  }
  return { generated, graded, waiting };
}
