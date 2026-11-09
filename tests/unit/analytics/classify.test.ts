import { describe, expect, it } from "vitest";
import { classifyAgent, classifySource, normalizeCountry, normalizePath } from "@/lib/analytics/classify";

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// Real user-agent strings as published by each operator.
const BOTS: [string, string, string][] = [
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)", "ai", "GPTBot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", "ai", "OAI-SearchBot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ai", "ChatGPT-User"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ai", "ClaudeBot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)", "ai", "Claude-SearchBot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "ai", "Claude-User"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "ai", "PerplexityBot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", "ai", "Perplexity-User"],
  ["Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "search", "Googlebot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36", "search", "Bingbot"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)", "search", "Applebot"],
  ["meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", "ai", "Meta-ExternalAgent"],
  ["CCBot/2.0 (https://commoncrawl.org/faq/)", "ai", "CCBot"],
];

describe("classifyAgent", () => {
  it.each(BOTS)("names %s", (ua, kind, name) => {
    expect(classifyAgent(ua)).toEqual({ kind, name });
  });

  it("treats a normal browser as a human", () => {
    expect(classifyAgent(CHROME)).toEqual({ kind: "human", name: "" });
  });

  it.each(["curl/8.4.0", "python-requests/2.31", "", "Mozilla/5.0 (compatible; SomeNewCrawler/1.0)", "Go-http-client/2.0"])(
    "marks %j as an unknown bot",
    (ua) => {
      expect(classifyAgent(ua)).toEqual({ kind: "bot", name: "unknown" });
    },
  );

  it("does not mistake a phone model containing BOT for a bot", () => {
    const cubot = "Mozilla/5.0 (Linux; Android 12; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    expect(classifyAgent(cubot)).toEqual({ kind: "human", name: "" });
  });

  it("handles a missing header", () => {
    expect(classifyAgent(null)).toEqual({ kind: "bot", name: "unknown" });
  });
});

describe("classifySource", () => {
  const page = new URL("https://masonbair.com/coffee");

  it.each([
    ["https://chatgpt.com/", "chatgpt.com", "ChatGPT"],
    ["https://www.perplexity.ai/search?q=x", "perplexity.ai", "Perplexity"],
    ["https://claude.ai/chat/abc", "claude.ai", "Claude"],
    ["https://gemini.google.com/app", "gemini.google.com", "Gemini"],
    ["https://copilot.microsoft.com/", "copilot.microsoft.com", "Copilot"],
    ["https://www.google.com/", "google.com", ""],
  ])("reads %s", (referrer, refHost, fromAssistant) => {
    expect(classifySource(referrer, page, "masonbair.com")).toEqual({ refHost, fromAssistant });
  });

  it("keeps only the host, never the path or query", () => {
    expect(classifySource("https://news.ycombinator.com/item?id=1", page, "masonbair.com").refHost).toBe("news.ycombinator.com");
  });

  it("credits utm_source=chatgpt.com when there is no referrer", () => {
    const url = new URL("https://masonbair.com/coffee?utm_source=chatgpt.com");
    expect(classifySource(null, url, "masonbair.com")).toEqual({ refHost: "", fromAssistant: "ChatGPT" });
  });

  it("drops the site's own host", () => {
    expect(classifySource("https://www.masonbair.com/", page, "masonbair.com").refHost).toBe("");
  });

  it("ignores a junk referrer", () => {
    expect(classifySource("not a url %%%", page, "masonbair.com")).toEqual({ refHost: "", fromAssistant: "" });
  });
});

describe("normalizePath", () => {
  it.each([
    ["/", "/"],
    ["/coffee", "/coffee"],
    ["/coffee/", "/coffee"],
    ["/COFFEE", "/coffee"],
    ["/llms.txt", "/llms.txt"],
    ["/wp-admin/install.php", "other"],
    ["/coffee?x=1", "other"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe("normalizeCountry", () => {
  it.each([
    ["us", "US"],
    ["GB", "GB"],
    ["USA", ""],
    [null, ""],
  ])("%s → %j", (input, expected) => {
    expect(normalizeCountry(input)).toBe(expected);
  });
});
