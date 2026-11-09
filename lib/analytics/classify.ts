export type VisitKind = "human" | "ai" | "search" | "bot";

export type Agent = { kind: VisitKind; name: string };

// Order matters: specific tokens (Claude-SearchBot, OAI-SearchBot) must match before broader ones.
const AGENTS: [RegExp, VisitKind, string][] = [
  [/OAI-SearchBot/i, "ai", "OAI-SearchBot"],
  [/ChatGPT-User/i, "ai", "ChatGPT-User"],
  [/GPTBot/i, "ai", "GPTBot"],
  [/Claude-SearchBot/i, "ai", "Claude-SearchBot"],
  [/Claude-User/i, "ai", "Claude-User"],
  [/ClaudeBot/i, "ai", "ClaudeBot"],
  [/Perplexity-User/i, "ai", "Perplexity-User"],
  [/PerplexityBot/i, "ai", "PerplexityBot"],
  [/Google-CloudVertexBot/i, "ai", "Google-CloudVertexBot"],
  [/Gemini-Deep-Research/i, "ai", "Gemini-Deep-Research"],
  [/meta-externalagent/i, "ai", "Meta-ExternalAgent"],
  [/meta-externalfetcher/i, "ai", "Meta-ExternalFetcher"],
  [/Amazonbot/i, "ai", "Amazonbot"],
  [/Bytespider/i, "ai", "Bytespider"],
  [/CCBot/i, "ai", "CCBot"],
  [/cohere-ai/i, "ai", "cohere-ai"],
  [/MistralAI-User/i, "ai", "MistralAI-User"],
  [/DuckAssistBot/i, "ai", "DuckAssistBot"],
  [/YouBot/i, "ai", "YouBot"],
  [/Diffbot/i, "ai", "Diffbot"],
  [/Googlebot/i, "search", "Googlebot"],
  [/bingbot/i, "search", "Bingbot"],
  [/Applebot/i, "search", "Applebot"],
  [/DuckDuckBot/i, "search", "DuckDuckBot"],
  [/YandexBot/i, "search", "YandexBot"],
  [/Baiduspider/i, "search", "Baiduspider"],
  [/Slurp/i, "search", "Yahoo"],
];

const GENERIC_BOT = /\bbot\b|bot\/|bot;|bot\)|crawl|spider|slurp|fetch|scrape|curl|wget|python-requests|httpx|axios|node-fetch|go-http-client|headless|lighthouse|preview/i;

/** Names the crawler or agent behind a user-agent; unknown automated clients become { kind: "bot", name: "unknown" }. */
export function classifyAgent(userAgent: string | null): Agent {
  const ua = userAgent ?? "";
  for (const [pattern, kind, name] of AGENTS) {
    if (pattern.test(ua)) return { kind, name };
  }
  if (!ua.trim() || GENERIC_BOT.test(ua) || !/Mozilla\//.test(ua)) return { kind: "bot", name: "unknown" };
  return { kind: "human", name: "" };
}

const ASSISTANT_HOSTS: [RegExp, string][] = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)claude\.ai$/, "Claude"],
  [/^gemini\.google\.com$|^bard\.google\.com$/, "Gemini"],
  [/^copilot\.microsoft\.com$|(^|\.)copilot\.cloud\.microsoft$/, "Copilot"],
  [/(^|\.)you\.com$/, "You.com"],
  [/(^|\.)phind\.com$/, "Phind"],
  [/(^|\.)meta\.ai$/, "Meta AI"],
  [/(^|\.)chat\.mistral\.ai$/, "Mistral"],
  [/(^|\.)chat\.deepseek\.com$/, "DeepSeek"],
];

function assistantFor(host: string): string {
  for (const [pattern, name] of ASSISTANT_HOSTS) {
    if (pattern.test(host)) return name;
  }
  return "";
}

function hostOf(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type Source = { refHost: string; fromAssistant: string };

/** Reduces a referrer and the page URL to a referring host plus the assistant it came from, if any. */
export function classifySource(referrer: string | null, pageUrl: URL, siteHost: string): Source {
  const refHost = referrer ? hostOf(referrer).slice(0, 100) : "";
  const utm = pageUrl.searchParams.get("utm_source") ?? "";
  const fromAssistant = assistantFor(refHost) || assistantFor(hostOf(utm));
  const ownSite = refHost === siteHost.replace(/^www\./, "") || refHost === "localhost";
  return { refHost: ownSite ? "" : refHost, fromAssistant };
}

// Add new public routes here; anything else is stored as "other".
const KNOWN_PATHS = new Set(["/", "/coffee", "/trends", "/llms.txt", "/robots.txt", "/sitemap.xml"]);

/** Maps a request path to a known route so arbitrary URLs never reach storage. */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const lower = trimmed.toLowerCase();
  return KNOWN_PATHS.has(lower) ? lower : "other";
}

/** Two-letter country code from the CDN header, or empty. */
export function normalizeCountry(header: string | null): string {
  const code = (header ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
