import { PRICES, type ModelId } from "@/lib/ai/claude";
import type { ExtractedStory } from "@/lib/news/extract";
import { headlineWords, jaccard } from "@/lib/news/dedupe";
import type { Topic } from "@/lib/news/prompt";

/** The four newsletters with sender addresses in news_sources (migration 0009). */
export const COMPARE_SOURCES = [
  { name: "Mindstream", address: "hello@mindstream.news" },
  { name: "Superhuman", address: "superhuman@mail.joinsuperhuman.ai" },
  { name: "The Hustle", address: "news@thehustle.co" },
  { name: "Tech Brew", address: "techbrew@morningbrew.com" },
] as const;

export type CompareIssue = { sourceName: string; messageId: string; subject: string; date: Date; text: string };

/** Adds one issue to a source's newest-first list, keeping at most `limit` and skipping repeats of a message. */
export function keepLatest(kept: CompareIssue[], issue: CompareIssue, limit: number): CompareIssue[] {
  if (kept.some((k) => k.messageId === issue.messageId)) return kept;
  return [...kept, issue].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
}

/** The newest `perSource` issues of each source, sources in COMPARE_SOURCES order. */
export function pickIssues(issues: Iterable<CompareIssue>, perSource = 5): CompareIssue[] {
  const bySource = new Map<string, CompareIssue[]>();
  for (const issue of issues) {
    if (issue.text.trim() === "") continue;
    bySource.set(issue.sourceName, keepLatest(bySource.get(issue.sourceName) ?? [], issue, perSource));
  }
  return COMPARE_SOURCES.flatMap((s) => bySource.get(s.name) ?? []);
}

/** Reads the (slug, name) pairs from the news_topics insert in a migration file. */
export function parseTopicSeed(sql: string): Topic[] {
  const insert = sql.match(/insert into public\.news_topics[\s\S]*?;/i)?.[0] ?? "";
  return [...insert.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)'\)/g)].map(([, slug, name]) => ({ slug, name }));
}

const companyKeys = (s: ExtractedStory) =>
  new Set(s.companies.flatMap((c) => [c.name.trim().toLowerCase(), ...(c.ticker ? [`$${c.ticker.toUpperCase()}`] : [])]));

/** 2 for a shared company, plus 1 for a shared topic with headline word overlap of at least 0.3; 0 means no match. */
export function matchScore(a: ExtractedStory, b: ExtractedStory): number {
  const keys = companyKeys(b);
  const sharesCompany = [...companyKeys(a)].some((k) => keys.has(k));
  const similar = a.topics.some((t) => b.topics.includes(t)) && jaccard(headlineWords(a.headline), headlineWords(b.headline)) >= 0.3;
  return (sharesCompany ? 2 : 0) + (similar ? 1 : 0);
}

/** One-to-one pairs [modelIndex, referenceIndex], best scores first. */
export function matchStories(model: ExtractedStory[], reference: ExtractedStory[]): [number, number][] {
  const options: { m: number; r: number; score: number; overlap: number }[] = [];
  model.forEach((a, m) =>
    reference.forEach((b, r) => {
      const score = matchScore(a, b);
      if (score > 0) options.push({ m, r, score, overlap: jaccard(headlineWords(a.headline), headlineWords(b.headline)) });
    }),
  );
  options.sort((x, y) => y.score - x.score || y.overlap - x.overlap || x.r - y.r || x.m - y.m);
  const usedM = new Set<number>();
  const usedR = new Set<number>();
  const pairs: [number, number][] = [];
  for (const o of options) {
    if (usedM.has(o.m) || usedR.has(o.r)) continue;
    usedM.add(o.m);
    usedR.add(o.r);
    pairs.push([o.m, o.r]);
  }
  return pairs;
}

const tickers = (s: ExtractedStory) => new Set(s.companies.flatMap((c) => (c.ticker ? [c.ticker.toUpperCase()] : [])));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export type IssueRun = { stories: ExtractedStory[] | null; costUsd: number };

export type ModelSummary = {
  issues: number;
  failed: number;
  stories: number;
  referenceStories: number;
  found: number;
  /** Share of Opus's stories this model also found. */
  foundRate: number;
  /** Of matched pairs, the share sharing at least one topic. */
  topicAgreement: number;
  /** Of matched pairs where either side named a ticker, the share with the same tickers. */
  tickerAgreement: number;
  tickerPairs: number;
  costUsd: number;
  costPerIssue: number;
};

const share = (n: number, d: number) => (d === 0 ? 0 : n / d);

/** Compares one model's runs with the reference runs, issue by issue; issues where the reference failed are left out of agreement. */
export function summarize(runs: IssueRun[], reference: IssueRun[]): ModelSummary {
  let failed = 0;
  let stories = 0;
  let referenceStories = 0;
  let found = 0;
  let topicHits = 0;
  let tickerPairs = 0;
  let tickerHits = 0;
  let costUsd = 0;
  runs.forEach((run, i) => {
    costUsd += run.costUsd;
    if (!run.stories) failed += 1;
    stories += run.stories?.length ?? 0;
    const ref = reference[i]?.stories;
    if (!ref) return;
    referenceStories += ref.length;
    for (const [m, r] of matchStories(run.stories ?? [], ref)) {
      const a = run.stories![m];
      const b = ref[r];
      found += 1;
      if (a.topics.some((t) => b.topics.includes(t))) topicHits += 1;
      const ta = tickers(a);
      const tb = tickers(b);
      if (ta.size || tb.size) {
        tickerPairs += 1;
        if (sameSet(ta, tb)) tickerHits += 1;
      }
    }
  });
  return {
    issues: runs.length,
    failed,
    stories,
    referenceStories,
    found,
    foundRate: share(found, referenceStories),
    topicAgreement: share(topicHits, found),
    tickerAgreement: share(tickerHits, tickerPairs),
    tickerPairs,
    costUsd,
    costPerIssue: share(costUsd, runs.length),
  };
}

/** The plan's rule: at least 80% of Opus's stories found and 75% topic agreement, cheapest first. */
export function passesRule(s: ModelSummary): boolean {
  return s.failed === 0 && s.foundRate >= 0.8 && s.topicAgreement >= 0.75;
}

/** Jobs ordered issue by issue, models in the given order, so an early stop still leaves the first model's output for the issues that ran. */
export function interleaveJobs<M>(models: readonly M[], issueCount: number): { m: M; i: number }[] {
  return Array.from({ length: issueCount }, (_, i) => models.map((m) => ({ m, i }))).flat();
}

/** Characters per token assumed when sizing a call; low on purpose so the estimate runs high. */
const CHARS_PER_TOKEN = 3;

/** Worst-case dollars for one extractIssue call: cache-write-priced input plus max output, doubled for its one internal retry. */
export function worstCaseUsd(model: ModelId, inputChars: number, maxOutputTokens: number): number {
  const p = PRICES[model];
  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
  return (2 * (inputTokens * p.input * 1.25 + maxOutputTokens * p.output)) / 1_000_000;
}

/** Tracks measured spend plus the worst case of calls in flight, and refuses a call that could pass the cap. */
export class SpendGuard {
  spent = 0;
  reserved = 0;
  constructor(readonly maxUsd: number) {}

  tryReserve(usd: number): boolean {
    if (this.spent + this.reserved + usd > this.maxUsd) return false;
    this.reserved += usd;
    return true;
  }

  settle(reservedUsd: number, measuredUsd: number): void {
    this.reserved -= reservedUsd;
    this.spent += measuredUsd;
  }
}
