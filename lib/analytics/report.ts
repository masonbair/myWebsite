import "server-only";
import { sessionClient } from "@/lib/supabase/server";

export type DailyPoint = { day: string; visitors: number; views: number; aiReads: number };

export type AnalyticsReport = {
  today: string;
  since: string;
  week: { visitors: number; views: number; coffee: number; aiReads: number; fromAssistants: number };
  daily: DailyPoint[];
  pages: { path: string; views: number | null; botReads: number | null; visitors: number }[];
  coffeeSources: { refHost: string; fromAssistant: string; country: string; hits: number; lastDay: string }[];
  agents: { agent: string; kind: "ai" | "search"; hits: number; lastSeen: string; byPath: Record<string, number> }[];
  assistants: { name: string; hits: number }[];
  referrers: { host: string; hits: number }[];
  unknownBots: { userAgent: string; hits: number }[];
};

/** Reads the last `days` days of rollups as the signed-in owner; RLS returns nothing for anyone else. */
export async function loadReport(days = 28): Promise<AnalyticsReport> {
  const supabase = await sessionClient();
  const { data, error } = await supabase.rpc("analytics_report", { p_days: days });
  if (error) throw new Error(`could not load analytics: ${error.message}`);
  return data as AnalyticsReport;
}
