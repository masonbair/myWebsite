import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod";
import type { ClaudeUsage, ModelId } from "@/lib/ai/claude";
import { replySchema, storySchema, systemPrompt, type Topic } from "@/lib/news/prompt";

export type ExtractInput = { sourceName: string; subject: string; publishedOn: string; text: string };

export type ExtractedStory = {
  headline: string;
  kind: "news" | "sponsor" | "other";
  topics: string[];
  suggestedTopic: string | null;
  companies: { name: string; ticker: string | null; exchange: string | null }[];
  sentiment: -2 | -1 | 0 | 1 | 2;
  link: string | null;
};

export type ExtractFailure = "refusal" | "max_tokens" | "schema";

export class ExtractError extends Error {
  constructor(
    readonly reason: ExtractFailure,
    readonly usage: ClaudeUsage,
    detail: string,
  ) {
    super(`extraction failed (${reason}): ${detail}`);
    this.name = "ExtractError";
  }
}

export const MAX_TEXT_CHARS = 120_000;
const FALLBACK_MODELS: ReadonlySet<ModelId> = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

type ExtractRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replyJsonSchema(topics: Topic[]) {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(storySchema(topics.map((t) => t.slug)));
  return transformJSONSchema(schema);
}

/** The request for one issue; `batch` drops the fallback beta, which the Batches API rejects. */
export function buildExtractRequest(
  input: ExtractInput,
  model: ModelId,
  topics: Topic[],
  opts: { batch?: boolean } = {},
): ExtractRequest {
  let text = input.text;
  if (text.length > MAX_TEXT_CHARS) {
    console.error(
      `news extract: cut ${input.sourceName} ${input.publishedOn} text from ${text.length} to ${MAX_TEXT_CHARS} chars`,
    );
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  // A closing tag inside the email must not end the data block early.
  text = text.replace(/<\/newsletter/gi, "</newsletter_");

  const open = `<newsletter source="${escapeAttr(input.sourceName)}" date="${escapeAttr(input.publishedOn)}" subject="${escapeAttr(input.subject)}">`;
  const request: ExtractRequest = {
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: systemPrompt(topics), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${open}\n${text}\n</newsletter>` }],
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: replyJsonSchema(topics),
      },
    },
  };
  if (!opts.batch && FALLBACK_MODELS.has(model)) {
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }
  return request;
}

function addUsage(total: ClaudeUsage, u: Anthropic.Beta.Messages.BetaUsage): ClaudeUsage {
  return {
    input_tokens: total.input_tokens + (u.input_tokens ?? 0),
    output_tokens: total.output_tokens + (u.output_tokens ?? 0),
    cache_read_input_tokens: (total.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: (total.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
  };
}

type Attempt = { ok: true; stories: ExtractedStory[] } | { ok: false; reason: ExtractFailure; detail: string };

function readReply(message: Anthropic.Beta.Messages.BetaMessage, allowed: Set<string>): Attempt {
  if (message.stop_reason === "refusal") return { ok: false, reason: "refusal", detail: "model declined" };
  if (message.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens", detail: "reply cut off" };
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "schema", detail: "reply is not JSON" };
  }
  const stories = (raw as { stories?: unknown })?.stories;
  if (Array.isArray(stories)) {
    for (const s of stories) {
      if (s && Array.isArray(s.topics)) s.topics = s.topics.filter((t: unknown) => typeof t === "string" && allowed.has(t));
    }
  }
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "schema", detail: parsed.error.issues[0]?.message ?? "bad shape" };
  return {
    ok: true,
    stories: parsed.data.stories.map(({ suggested_topic, ...s }) => ({ ...s, suggestedTopic: suggested_topic })),
  };
}

/** Splits one issue into stories; retries once on refusal, cut-off or bad shape, then throws ExtractError. */
export async function extractIssue(
  input: ExtractInput,
  deps: { client: Anthropic; model: ModelId; topics: Topic[] },
): Promise<{ stories: ExtractedStory[]; usage: ClaudeUsage }> {
  const request = buildExtractRequest(input, deps.model, deps.topics);
  const allowed = new Set(deps.topics.map((t) => t.slug));
  let usage: ClaudeUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let last: Attempt | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await deps.client.beta.messages.create(request);
    usage = addUsage(usage, message.usage);
    last = readReply(message, allowed);
    if (last.ok) return { stories: last.stories, usage };
  }
  const failed = last as Extract<Attempt, { ok: false }>;
  throw new ExtractError(failed.reason, usage, failed.detail);
}
