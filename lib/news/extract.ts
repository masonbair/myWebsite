import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod";
import { PRICES, type ClaudeUsage, type ModelId } from "@/lib/ai/claude";
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

export type ExtractFailure = "refusal" | "max_tokens" | "schema" | "api";

export class ExtractError extends Error {
  constructor(
    readonly reason: ExtractFailure,
    readonly usage: ClaudeUsage,
    readonly charges: ModelCharge[],
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`extraction failed (${reason}): ${detail}`, options);
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

/** Tokens one model used, so each ai_usage row is priced by the model that actually ran. */
export type ModelCharge = { model: ModelId; usage: ClaudeUsage };

type TokenCounts = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function knownModel(model: string | null | undefined, fallback: ModelId): ModelId {
  return model && model in PRICES ? (model as ModelId) : fallback;
}

const ZERO: ClaudeUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function sumUsage(a: ClaudeUsage, b: TokenCounts): ClaudeUsage {
  return {
    input_tokens: a.input_tokens + (b.input_tokens ?? 0),
    output_tokens: a.output_tokens + (b.output_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  };
}

function addCharge(charges: ModelCharge[], model: ModelId, u: TokenCounts): void {
  const charge = charges.find((c) => c.model === model);
  if (charge) charge.usage = sumUsage(charge.usage, u);
  else charges.push({ model, usage: sumUsage(ZERO, u) });
}

function chargeMessage(charges: ModelCharge[], message: Anthropic.Beta.Messages.BetaMessage, requested: ModelId): void {
  const steps = (message.usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  if (steps.length === 0) {
    addCharge(charges, knownModel(message.model, requested), message.usage);
    return;
  }
  for (const step of steps) addCharge(charges, knownModel(step.model, requested), step);
}

function totalUsage(charges: ModelCharge[]): ClaudeUsage {
  return charges.reduce((sum, c) => sumUsage(sum, c.usage), ZERO);
}

export type ExtractAttempt = { ok: true; stories: ExtractedStory[] } | { ok: false; reason: ExtractFailure; detail: string };

/** Text after the last fallback block: earlier text belongs to a model that declined part way. */
function replyText(content: Anthropic.Beta.Messages.BetaContentBlock[]): string {
  let from = 0;
  content.forEach((b, i) => {
    if (b.type === "fallback") from = i + 1;
  });
  return content
    .slice(from)
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("");
}

// The API cannot enforce maxItems or minLength, so trim rather than fail the whole issue over them.
function tidy(raw: unknown, allowed: Set<string>): unknown {
  const stories = (raw as { stories?: unknown })?.stories;
  if (!Array.isArray(stories)) return raw;
  const kept = stories.filter((s) => !(s && typeof s.headline === "string" && s.headline.trim() === ""));
  for (const s of kept) {
    if (s && Array.isArray(s.topics)) {
      const known = s.topics.filter((t: unknown): t is string => typeof t === "string" && allowed.has(t));
      s.topics = [...new Set(known)].slice(0, 3);
    }
  }
  return { ...(raw as object), stories: kept };
}

function readReply(message: Anthropic.Beta.Messages.BetaMessage, allowed: Set<string>): ExtractAttempt {
  if (message.stop_reason === "refusal") return { ok: false, reason: "refusal", detail: "model declined" };
  if (message.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens", detail: "reply cut off" };
  let raw: unknown;
  try {
    raw = JSON.parse(replyText(message.content));
  } catch {
    return { ok: false, reason: "schema", detail: "reply is not JSON" };
  }
  const parsed = replySchema.safeParse(tidy(raw, allowed));
  if (!parsed.success) return { ok: false, reason: "schema", detail: parsed.error.issues[0]?.message ?? "bad shape" };
  return {
    ok: true,
    stories: parsed.data.stories.map(({ suggested_topic, ...s }) => ({ ...s, suggestedTopic: suggested_topic })),
  };
}

/** Reads one finished reply with extractIssue's rules (for Batch results); `charges` is what each model billed. */
export function readExtractMessage(
  message: Anthropic.Beta.Messages.BetaMessage,
  requested: ModelId,
  topics: Topic[],
): { outcome: ExtractAttempt; charges: ModelCharge[] } {
  const charges: ModelCharge[] = [];
  chargeMessage(charges, message, requested);
  return { outcome: readReply(message, new Set(topics.map((t) => t.slug))), charges };
}

export type ExtractResult = { stories: ExtractedStory[]; usage: ClaudeUsage; charges: ModelCharge[] };

/** Splits one issue into stories; retries once on refusal, cut-off or bad shape, then throws ExtractError. */
export async function extractIssue(
  input: ExtractInput,
  deps: { client: Anthropic; model: ModelId; topics: Topic[] },
): Promise<ExtractResult> {
  const request = buildExtractRequest(input, deps.model, deps.topics);
  const allowed = new Set(deps.topics.map((t) => t.slug));
  const charges: ModelCharge[] = [];
  let last: ExtractAttempt | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await deps.client.beta.messages.create(request);
    } catch (cause) {
      // The SDK already retried transient errors, so one more try here would only add spend.
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ExtractError("api", totalUsage(charges), charges, detail, { cause });
    }
    chargeMessage(charges, message, deps.model);
    last = readReply(message, allowed);
    if (last.ok) return { stories: last.stories, usage: totalUsage(charges), charges };
  }
  const failed = last as Extract<ExtractAttempt, { ok: false }>;
  throw new ExtractError(failed.reason, totalUsage(charges), charges, failed.detail);
}
