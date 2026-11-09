import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export type TrendKind = "topic" | "company";
export type TrendRow = {
  day: string;
  kind: TrendKind;
  key: string;
  label: string;
  ticker: string | null;
  stories: number;
  mentions: number;
  toneAvg: number;
  sources: string[];
};
export type Coverage = { day: string; sourceName: string; publicUrl: string };
export type PublicTrends = { today: string; rows: TrendRow[] };
export type Subject = { kind: TrendKind; key: string; label: string; ticker: string | null; today: string; rows: TrendRow[]; coverage: Coverage[] };

/** Raw reads behind the public trend pages; the database one calls only the text-free trend functions. */
export type TrendStore = {
  today?: string;
  trends(from: string, to: string, only?: { kind: TrendKind; key: string }): Promise<unknown[]>;
  coverage(kind: TrendKind, key: string, from: string): Promise<unknown[]>;
  inactiveTopics(): Promise<string[]>;
};
type Deps = { store?: TrendStore | null };

/** Days of rows the movers need: the last week plus the four before it. */
export const MOVER_DAYS = 35;
/** Days in the 52 weekly buckets a subject page charts. */
export const YEAR_DAYS = 52 * 7;

const KEY: Record<TrendKind, RegExp> = { topic: /^[a-z0-9-]{2,40}$/, company: /^[1-9][0-9]{0,17}$/ };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PLAIN_HTTPS = /^https:\/\/[^\s?#"'<>]+$/;
const PAGE = 1000;

export const isTrendKind = (v: unknown): v is TrendKind => v === "topic" || v === "company";
export const isTrendKey = (kind: TrendKind, key: string) => KEY[kind].test(key);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function parseRow(raw: unknown): TrendRow | null {
  if (!isObj(raw)) return null;
  const { day, kind, key, label, ticker, stories, mentions, tone_avg, sources } = raw;
  const tone = typeof tone_avg === "string" || typeof tone_avg === "number" ? Number(tone_avg) : NaN;
  if (typeof day !== "string" || !DAY.test(day) || !isTrendKind(kind) || typeof key !== "string" || !isTrendKey(kind, key)) return null;
  if (typeof label !== "string" || label.trim() === "" || count(stories) === null || count(mentions) === null) return null;
  if (!Number.isFinite(tone) || tone < -1 || tone > 1 || !Array.isArray(sources)) return null;
  return {
    day,
    kind,
    key,
    label,
    ticker: typeof ticker === "string" && ticker !== "" ? ticker : null,
    stories: stories as number,
    mentions: mentions as number,
    toneAvg: tone,
    sources: sources.filter((s): s is string => typeof s === "string"),
  };
}

function parseCoverage(raw: unknown): Coverage | null {
  if (!isObj(raw)) return null;
  const { day, source_name, public_url } = raw;
  if (typeof day !== "string" || !DAY.test(day) || typeof source_name !== "string" || source_name.trim() === "") return null;
  if (typeof public_url !== "string" || !PLAIN_HTTPS.test(public_url)) return null;
  return { day, sourceName: source_name, publicUrl: public_url };
}

async function activeRows(store: TrendStore, raw: unknown[]): Promise<TrendRow[]> {
  // Trend rows outlive a topic being switched off until the next rebuild, so the reader drops them itself.
  const inactive = new Set(await store.inactiveTopics());
  return raw
    .map(parseRow)
    .filter((r): r is TrendRow => r !== null && !(r.kind === "topic" && inactive.has(r.key)))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function easternToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function databaseStore(client: SupabaseClient): TrendStore {
  return {
    async trends(from, to, only) {
      const out: unknown[] = [];
      for (let start = 0; ; start += PAGE) {
        let q = client.rpc("news_public_trends", { p_from: from, p_to: to });
        if (only) q = q.eq("kind", only.kind).eq("key", only.key);
        const { data, error } = await q.range(start, start + PAGE - 1);
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < PAGE) return out;
      }
    },
    async coverage(kind, key, from) {
      const { data, error } = await client.rpc("news_public_coverage", { p_kind: kind, p_key: key, p_from: from }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
    async inactiveTopics() {
      const { data, error } = await client.from("news_topics").select("slug").eq("active", false);
      if (error) throw error;
      return (data ?? []).map((r: { slug: string }) => r.slug);
    },
  };
}

const FIXTURE_NAME = /^[a-z0-9-]+\.json$/;

function fixtureStore(name: string): TrendStore {
  const parsed: unknown = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "e2e", "fixtures", name), "utf8"));
  const data = isObj(parsed) ? parsed : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  return {
    // The fixture pins its own date so the e2e expectations never drift.
    today: typeof data.today === "string" && DAY.test(data.today) ? data.today : undefined,
    async trends(from, to, only) {
      return list(data.trends).filter(
        (r) => String(r.day) >= from && String(r.day) <= to && (!only || (r.kind === only.kind && r.key === only.key)),
      );
    },
    async coverage(kind, key, from) {
      return list(data.coverage)
        .filter((r) => r.kind === kind && r.key === key && String(r.day) >= from)
        .sort((a, b) => String(b.day).localeCompare(String(a.day)));
    },
    async inactiveTopics() {
      return Array.isArray(data.inactive_topics) ? data.inactive_topics.filter((s): s is string => typeof s === "string") : [];
    },
  };
}

// Test-only override set by Playwright; the strict name check keeps it inside the fixtures folder.
function defaultStore(): TrendStore | null {
  const fixture = process.env.TRENDS_FIXTURE;
  if (fixture && process.env.NODE_ENV !== "production" && FIXTURE_NAME.test(fixture)) return fixtureStore(fixture);
  // Empty on the e2e site servers and in tests, so they never read a real database.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return databaseStore(serviceClient());
}

/** The last 35 days of public trend rows, or null when there is no database or it fails. */
export async function readPublicTrends(deps: Deps = {}): Promise<PublicTrends | null> {
  try {
    const store = deps.store !== undefined ? deps.store : defaultStore();
    if (!store) return null;
    const today = store.today ?? easternToday();
    const rows = await activeRows(store, await store.trends(addDays(today, -(MOVER_DAYS - 1)), today));
    return { today, rows };
  } catch {
    return null;
  }
}

/** One topic or company over 52 weeks with its newsletter links; null when unknown, inactive or unreadable. */
export async function readSubject(kind: string, key: string, deps: Deps = {}): Promise<Subject | null> {
  if (!isTrendKind(kind) || !isTrendKey(kind, key)) return null;
  try {
    const store = deps.store !== undefined ? deps.store : defaultStore();
    if (!store) return null;
    const today = store.today ?? easternToday();
    const from = addDays(today, -(YEAR_DAYS - 1));
    const [rawRows, rawCoverage] = await Promise.all([store.trends(from, today, { kind, key }), store.coverage(kind, key, from)]);
    const rows = (await activeRows(store, rawRows)).filter((r) => r.kind === kind && r.key === key);
    const latest = rows.at(-1);
    if (!latest) return null;
    const coverage = rawCoverage.map(parseCoverage).filter((c): c is Coverage => c !== null);
    return { kind, key, label: latest.label, ticker: latest.ticker, today, rows, coverage };
  } catch {
    return null;
  }
}
