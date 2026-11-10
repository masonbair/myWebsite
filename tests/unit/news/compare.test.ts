import { describe, expect, it } from "vitest";
import { interleaveJobs, matchScore, matchStories, parseTopicSeed, passesRule, pickIssues, SpendGuard, summarize, worstCaseUsd, type CompareIssue } from "@/lib/news/compare";
import type { ExtractedStory } from "@/lib/news/extract";

const issue = (sourceName: string, day: number, id = `${sourceName}-${day}`): CompareIssue => ({
  sourceName,
  messageId: id,
  subject: `Issue ${day}`,
  date: new Date(Date.UTC(2026, 9, day)),
  text: "body",
});

const story = (headline: string, topics: string[], companies: [string, string | null][] = []): ExtractedStory => ({
  headline,
  kind: "news",
  topics,
  suggestedTopic: null,
  companies: companies.map(([name, ticker]) => ({ name, ticker, exchange: null })),
  sentiment: 0,
  link: null,
});

describe("pickIssues", () => {
  it("keeps the 5 newest per source, in source order, skipping repeats and empty text", () => {
    const all = [
      ...[1, 2, 3, 4, 5, 6, 7].map((d) => issue("The Hustle", d)),
      ...[10, 11].map((d) => issue("Mindstream", d)),
      issue("Mindstream", 11),
      { ...issue("Mindstream", 12), text: "  " },
    ];
    const picked = pickIssues(all);
    expect(picked.map((i) => `${i.sourceName} ${i.date.getUTCDate()}`)).toEqual([
      "Mindstream 11",
      "Mindstream 10",
      "The Hustle 7",
      "The Hustle 6",
      "The Hustle 5",
      "The Hustle 4",
      "The Hustle 3",
    ]);
  });
});

describe("parseTopicSeed", () => {
  it("reads slug and name pairs from the news_topics insert only", () => {
    const sql = `insert into public.other (slug, name) values ('x', 'X');
insert into public.news_topics (slug, name) values
  ('ai-models', 'AI models'),
  ('ev-batteries', 'EVs and batteries')
on conflict (slug) do nothing;`;
    expect(parseTopicSeed(sql)).toEqual([
      { slug: "ai-models", name: "AI models" },
      { slug: "ev-batteries", name: "EVs and batteries" },
    ]);
  });
});

describe("matchScore", () => {
  it("scores a shared company (by name or ticker) 2 and a shared topic with similar words 1", () => {
    const a = story("Nvidia posts record chip sales", ["chips"], [["Nvidia", "NVDA"]]);
    expect(matchScore(a, story("Something else entirely", ["space"], [["NVIDIA Corp", "nvda"]]))).toBe(2);
    expect(matchScore(a, story("Record chip sales at Nvidia", ["chips"]))).toBe(1);
    expect(matchScore(a, story("Record chip sales at Nvidia", ["space"]))).toBe(0);
    expect(matchScore(a, story("Intel cuts jobs", ["chips"]))).toBe(0);
  });
});

describe("matchStories", () => {
  it("pairs one to one, best score first", () => {
    const ref = [story("Apple ships new iPhone", ["consumer-tech"], [["Apple", "AAPL"]]), story("Rates held steady by Fed", ["interest-rates"])];
    const model = [story("Fed holds rates steady", ["interest-rates"]), story("New iPhone ships", ["consumer-tech"], [["Apple", "AAPL"]]), story("Apple stock", [], [["Apple", "AAPL"]])];
    expect(matchStories(model, ref)).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});

describe("summarize", () => {
  const ref = [
    story("Apple ships new iPhone", ["consumer-tech"], [["Apple", "AAPL"]]),
    story("Fed holds rates steady", ["interest-rates"]),
    story("Tesla recalls cars", ["autos"], [["Tesla", "TSLA"]]),
    story("Sponsor: try our app", ["media"]),
  ];

  it("counts found stories, topic and ticker agreement, cost and failures", () => {
    const runs = [
      {
        stories: [
          story("iPhone launch", ["consumer-tech"], [["Apple", "AAPL"]]),
          story("Tesla recall", ["ev-batteries"], [["Tesla", null]]),
          story("Fed rates steady holds", ["interest-rates"]),
        ],
        costUsd: 0.02,
      },
      { stories: null, costUsd: 0.01 },
    ];
    const s = summarize(runs, [{ stories: ref, costUsd: 0.1 }, { stories: ref, costUsd: 0.1 }]);
    expect(s).toMatchObject({ issues: 2, failed: 1, stories: 3, referenceStories: 8, found: 3, tickerPairs: 2 });
    expect(s.foundRate).toBeCloseTo(3 / 8);
    expect(s.topicAgreement).toBeCloseTo(2 / 3);
    expect(s.tickerAgreement).toBeCloseTo(1 / 2);
    expect(s.costUsd).toBeCloseTo(0.03);
    expect(s.costPerIssue).toBeCloseTo(0.015);
    expect(passesRule(s)).toBe(false);
  });

  it("leaves out issues where the reference failed and passes the rule at 80% found and 75% topics", () => {
    const runs = [{ stories: ref.slice(0, 3), costUsd: 0 }, { stories: ref, costUsd: 0 }];
    const s = summarize(runs, [{ stories: ref, costUsd: 0 }, { stories: null, costUsd: 0 }]);
    expect(s).toMatchObject({ referenceStories: 4, found: 3, foundRate: 0.75 });
    expect(passesRule(s)).toBe(false);
    expect(passesRule(summarize([{ stories: ref, costUsd: 0 }], [{ stories: ref, costUsd: 0 }]))).toBe(true);
  });
});

describe("spend cap", () => {
  it("prices the worst case with cache-write input, max output and one retry", () => {
    // 3000 chars = 1000 tokens; opus: (1000*4*1.25 + 2000*20)/1e6 = 0.045; x2
    expect(worstCaseUsd("claude-opus-5-5", 3000, 2000)).toBeCloseTo(0.09, 6);
  });

  it("refuses a call that would pass the cap alongside in-flight reservations", () => {
    const g = new SpendGuard(1);
    expect(g.tryReserve(0.6)).toBe(true);
    expect(g.tryReserve(0.5)).toBe(false);
    g.settle(0.6, 0.1);
    expect(g.reserved).toBeCloseTo(0);
    expect(g.spent).toBeCloseTo(0.1);
    expect(g.tryReserve(0.9)).toBe(true);
    expect(g.tryReserve(0.01)).toBe(false);
  });
});

describe("interleaveJobs", () => {
  it("runs every model for one issue before the next issue", () => {
    expect(interleaveJobs(["opus", "sonnet", "haiku"], 2).map((j) => `${j.i}:${j.m}`)).toEqual([
      "0:opus", "0:sonnet", "0:haiku", "1:opus", "1:sonnet", "1:haiku",
    ]);
  });
});
