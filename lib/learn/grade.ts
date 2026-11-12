import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod";
import { PRICES, type ClaudeUsage, type ModelId } from "@/lib/ai/claude";
import { fence, graderSystem, graderUser, JUDGE_SYSTEM, judgeUser, type GradeInput } from "./rubric";
import { GRADES, type Grade, type ReportCard } from "./types";

const GRADE_MODEL: ModelId = "claude-opus-5-5";
const JUDGE_MODEL: ModelId = "claude-haiku-5-5";
const REQUEST_OPTIONS = { timeout: 90_000, maxRetries: 1 } as const;

export type GradeFailure = "refusal" | "schema" | "api";

/** `charge` is set when Claude answered (and billed) before the failure, so the caller can still log the cost. */
export class GradeError extends Error {
  readonly charge: { model: ModelId; usage: ClaudeUsage } | null;
  constructor(
    readonly reason: GradeFailure,
    detail: string,
    options?: { cause?: unknown; charge?: { model: ModelId; usage: ClaudeUsage } },
  ) {
    super(`grading failed (${reason}): ${detail}`, { cause: options?.cause });
    this.name = "GradeError";
    this.charge = options?.charge ?? null;
  }
}

const cardSchema = z.object({
  grade: z.enum(GRADES as [Grade, ...Grade[]]),
  worked: z.string().min(1).max(1000),
  fix: z.string().min(1).max(1000),
  better: z.string().max(4000),
  resources: z
    .array(z.object({ title: z.string().min(1).max(300), url: z.string().regex(/^https:\/\/\S+$/).max(2000) }))
    .min(1)
    .max(2),
  jargonOpening: z.boolean().nullable(),
  delivery: z.string().max(1000).nullable(),
});

const verdictSchema = z.object({ accepted: z.boolean(), feedback: z.string().min(1).max(600) });

function jsonSchema(schema: z.ZodType) {
  const out: Record<string, unknown> = { ...z.toJSONSchema(schema) };
  delete out.$schema;
  return transformJSONSchema(out);
}

/** A silent recording gets this card with no Claude call. */
export const NO_ANSWER_CARD: ReportCard = {
  grade: "F",
  worked: "Nothing was heard in the recording.",
  fix: "Record again tomorrow; speak for at least 30 seconds.",
  better: "",
  resources: [],
  jargonOpening: null,
  delivery: null,
};

type Reply = { model?: string; stop_reason?: string | null; content: { type: string; text?: string }[]; usage: ClaudeUsage };

function knownModel(model: string | undefined, fallback: ModelId): ModelId {
  return model && Object.hasOwn(PRICES, model) ? (model as ModelId) : fallback;
}

async function ask<T>(
  anthropic: Anthropic,
  model: ModelId,
  system: string,
  user: string,
  schema: z.ZodType<T>,
  maxTokens: number,
): Promise<{ value: T; usage: ClaudeUsage; model: ModelId }> {
  const request: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: jsonSchema(schema) } },
  };
  if (model !== JUDGE_MODEL) {
    request.output_config = { ...request.output_config, effort: "medium" };
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }
  let reply: Reply;
  try {
    reply = (await anthropic.beta.messages.create(request, REQUEST_OPTIONS)) as unknown as Reply;
  } catch (e) {
    throw new GradeError("api", (e as Error).name, { cause: e });
  }
  const charge = { model: knownModel(reply.model, model), usage: reply.usage };
  if (reply.stop_reason === "refusal") throw new GradeError("refusal", "Claude declined", { charge });
  const text = reply.content.find((c) => c.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GradeError("schema", "reply was not JSON", { charge });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new GradeError("schema", result.error.issues[0]?.message ?? "bad shape", { charge });
  return { value: result.data, usage: charge.usage, model: charge.model };
}

/** Grades one answer on its rubric; the card never carries minutes, which only the grade table decides. */
export async function gradeAnswer(
  anthropic: Anthropic,
  input: GradeInput,
): Promise<{ card: ReportCard; usage: ClaudeUsage; model: ModelId }> {
  const fenced = fence(input.answerText);
  const { value, usage, model } = await ask(anthropic, GRADE_MODEL, graderSystem(input.type), graderUser(input, fenced), cardSchema, 4000);
  const card: ReportCard = {
    grade: value.grade,
    worked: value.worked,
    fix: value.fix,
    better: value.better,
    resources: value.resources,
    jargonOpening: value.jargonOpening,
    delivery: value.delivery,
  };
  return { card, usage, model };
}

/** Accepts a takeaway only when it shows something specific from the article beyond the summary shown. */
export async function judgeTakeaway(
  anthropic: Anthropic,
  r: { title: string; url: string; summary: string; takeaway: string },
): Promise<{ accepted: boolean; feedback: string; usage: ClaudeUsage; model: ModelId }> {
  const fenced = fence(r.takeaway);
  const { value, usage, model } = await ask(anthropic, JUDGE_MODEL, JUDGE_SYSTEM, judgeUser(r, fenced), verdictSchema, 500);
  return { accepted: value.accepted, feedback: value.feedback, usage, model };
}
