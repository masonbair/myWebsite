import { localDate } from "@/lib/ideas/resurface";
import type { LearnType, TopicSlug } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const ROTATION: TopicSlug[] = ["value", "products", "communication"];

/** The calendar date in Mason's zone, YYYY-MM-DD. */
export const learnDate = localDate;

/** The day's two cards: explain-it-simply first, then value, products or communication (voice) in turn. */
export function dayPlan(date: string): { position: 1 | 2; topic: TopicSlug; type: LearnType }[] {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  const topic = ROTATION[((days % 3) + 3) % 3];
  return [
    { position: 1, topic: "explain-simply", type: "explain" },
    { position: 2, topic, type: topic === "communication" ? "voice" : "scenario" },
  ];
}

function isLocal(url: string | undefined): boolean {
  if (!url || !URL.canParse(url)) return false;
  return ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
}

/** Today in Mason's zone; e2e may pin it, since learn rows are never deleted, but only on a local non-production stack. */
export function learnToday(now: Date, timeZone: string, env: Record<string, string | undefined> = process.env): string {
  const pinned = env.LEARN_E2E_TODAY;
  if (pinned && DATE.test(pinned) && env.NODE_ENV !== "production" && isLocal(env.NEXT_PUBLIC_SUPABASE_URL)) return pinned;
  return learnDate(now, timeZone);
}
