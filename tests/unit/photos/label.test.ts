import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { LABEL_SYSTEM, labelPhoto, LabelError, parseLabel, shrinkForLabel } from "@/lib/photos/label";

const good = { description: "Mason smiling at a cafe table.", kind: "portrait", places: ["coffee", "slideshow"], score: 8 };

function reply(body: unknown, stop_reason = "end_turn") {
  return {
    model: "claude-haiku-5-5",
    stop_reason,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    usage: { input_tokens: 1200, output_tokens: 60 },
  };
}

function stubClient(r: unknown) {
  const create = vi.fn().mockResolvedValue(r);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("parseLabel", () => {
  it("keeps a valid label and orders its places", () => {
    expect(parseLabel(good)).toEqual({ ...good, places: ["slideshow", "coffee"] });
  });

  it("refuses unknown kinds, places and scores", () => {
    expect(parseLabel({ ...good, kind: "selfie" })).toBeNull();
    expect(parseLabel({ ...good, places: ["homepage"] })).toBeNull();
    expect(parseLabel({ ...good, score: 11 })).toBeNull();
    expect(parseLabel({ ...good, score: 7.5 })).toBeNull();
    expect(parseLabel({ ...good, description: "" })).toBeNull();
    expect(parseLabel(null)).toBeNull();
  });

  it("keeps the tags but drops a description that names a place", () => {
    expect(parseLabel({ ...good, description: "Mason at a cafe in Lisbon." })).toEqual({
      description: null,
      kind: "portrait",
      places: ["slideshow", "coffee"],
      score: 8,
    });
  });
});

describe("labelPhoto", () => {
  it("sends one JPEG image to Haiku with the privacy rules and a JSON schema", async () => {
    const { client, create } = stubClient(reply(good));
    const out = await labelPhoto(client, new Uint8Array([0xff, 0xd8, 0xff]));
    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system).toBe(LABEL_SYSTEM);
    expect(LABEL_SYSTEM).toContain("Never name or hint at a place");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/" } });
    expect(out.label.places).toEqual(["slideshow", "coffee"]);
    expect(out.usage.input_tokens).toBe(1200);
  });

  it("fails with the charge so a bad reply is still billed", async () => {
    for (const [r, reason] of [
      [reply("not json"), "schema"],
      [reply({ ...good, kind: "nope" }), "schema"],
      [reply(good, "refusal"), "refusal"],
    ] as const) {
      const error = await labelPhoto(stubClient(r).client, new Uint8Array([1])).catch((e) => e);
      expect(error).toBeInstanceOf(LabelError);
      expect(error.reason).toBe(reason);
      expect(error.charge?.usage.input_tokens).toBe(1200);
    }
  });
});

describe("shrinkForLabel", () => {
  it("makes a JPEG no larger than 1080 px a side", async () => {
    const big = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "teal" } }).jpeg().toBuffer();
    const meta = await sharp(await shrinkForLabel(new Uint8Array(big))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, 720]);
  });

  it("calls a broken file the photo's fault", async () => {
    await expect(shrinkForLabel(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ reason: "image" });
  });
});
