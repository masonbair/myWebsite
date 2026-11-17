import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import sharp from "sharp";
import { z } from "zod";
import { PRICES, type ClaudeUsage, type ModelId } from "@/lib/ai/claude";
import { MAX_INPUT_PIXELS } from "@/lib/photo-server";
import { safeDescription } from "./privacy";

export const LABEL_MODEL: ModelId = "claude-haiku-5-5";
export const KINDS = ["portrait", "travel", "event", "food", "scenery", "other"] as const;
export const PLACES = ["slideshow", "coffee"] as const;
export type PhotoKind = (typeof KINDS)[number];
export type PhotoPlace = (typeof PLACES)[number];
export type PhotoLabel = { description: string | null; kind: PhotoKind; places: PhotoPlace[]; score: number };

// About 1,100 image tokens a photo; larger only costs more, it does not label better.
const LABEL_EDGE = 1080;
const REQUEST_OPTIONS = { timeout: 60_000, maxRetries: 1 } as const;

const replySchema = z.object({
  description: z.string().min(1).max(400),
  kind: z.enum(KINDS),
  places: z.array(z.enum(PLACES)).max(PLACES.length),
  score: z.number().int().min(1).max(10),
});

export const LABEL_SYSTEM = `You label photos for Mason's personal website. Mason is the site's owner; most photos show him.

Return JSON only, matching the schema:
- description: one short sentence of alt text (under 150 characters) saying what is in the photo, e.g. "Mason smiling with a coffee at a small cafe table."
- kind: portrait (Mason is the main subject), travel, event, food, scenery or other.
- places: where the photo fits on the site. Any of:
  - slideshow: almost every decent photo. Leave it out only for blurry, dark, screenshots, documents, or anything private or embarrassing.
  - coffee: Mason looks friendly and approachable, face visible, alone or clearly the focus. Good for a "book a coffee chat with me" page.
- score: 1-10, how good this photo would look on the site.

Privacy rules. These are strict:
- Never name or hint at a place: no city, country, region, street, landmark, building, park, beach name, venue, business, restaurant, shop, brand or event name.
- Never read out or quote any text, sign, menu, banner, number plate or label in the photo.
- Never name anyone. Call Mason "Mason". Anyone else is "a friend", "two friends", "a person" and so on.
- No numbers or digits. Do not guess the weather, date or season.
- Use plain lower-case words, apart from "Mason" and the first word of the sentence.`;

export class LabelError extends Error {
  constructor(
    /** "refusal" and "schema" are the photo's fault and count as a failed attempt. */
    readonly reason: "refusal" | "schema" | "image",
    readonly charge: { model: ModelId; usage: ClaudeUsage } | null = null,
  ) {
    super(`photo label failed: ${reason}`);
    this.name = "LabelError";
  }
}

/** A small JPEG of the photo for Claude: upright, at most 1080 px a side, metadata dropped. */
export async function shrinkForLabel(input: Uint8Array): Promise<Uint8Array> {
  try {
    const out = await sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: LABEL_EDGE, height: LABEL_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return new Uint8Array(out);
  } catch {
    throw new LabelError("image");
  }
}

function formatSchema() {
  const out: Record<string, unknown> = { ...z.toJSONSchema(replySchema) };
  delete out.$schema;
  return transformJSONSchema(out);
}

/** Checks Claude's reply and applies the privacy check; an unsafe description becomes null, the rest of the label stays. */
export function parseLabel(raw: unknown): PhotoLabel | null {
  const result = replySchema.safeParse(raw);
  if (!result.success) return null;
  const { description, kind, places, score } = result.data;
  return { description: safeDescription(description), kind, places: PLACES.filter((p) => places.includes(p)), score };
}

type Reply = { model?: string; stop_reason?: string | null; content: { type: string; text?: string }[]; usage: ClaudeUsage };

/** Sends one shrunk photo to Haiku and returns its checked label with the usage to bill. */
export async function labelPhoto(
  anthropic: Anthropic,
  jpeg: Uint8Array,
): Promise<{ label: PhotoLabel; usage: ClaudeUsage; model: ModelId }> {
  const reply = (await anthropic.messages.create(
    {
      model: LABEL_MODEL,
      max_tokens: 1000,
      system: LABEL_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: formatSchema() } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } },
            { type: "text", text: "Label this photo." },
          ],
        },
      ],
    },
    REQUEST_OPTIONS,
  )) as unknown as Reply;
  const model = reply.model && Object.hasOwn(PRICES, reply.model) ? (reply.model as ModelId) : LABEL_MODEL;
  const charge = { model, usage: reply.usage };
  if (reply.stop_reason === "refusal") throw new LabelError("refusal", charge);
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.content.find((c) => c.type === "text")?.text ?? "");
  } catch {
    throw new LabelError("schema", charge);
  }
  const label = parseLabel(parsed);
  if (!label) throw new LabelError("schema", charge);
  return { label, usage: reply.usage, model };
}
