import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { GradeError, gradeAnswer, judgeTakeaway } from "@/lib/learn/grade";
import { graderSystem, type GradeInput } from "@/lib/learn/rubric";

afterEach(() => vi.restoreAllMocks());

const input: GradeInput = {
  type: "explain",
  topic: "explain-simply",
  question: "A bakery owner asks why her site was down after the move.",
  client: "Rosa, who runs a bakery",
  answerText: "Your website's address had to be updated everywhere, and that took an hour to spread.",
  durationMs: null,
};

const card = {
  grade: "B+",
  worked: "You led with what she lost.",
  fix: "Say how long it will take next time.",
  better: "Your site's new home needed its address updated, which takes about an hour to reach everyone.",
  resources: [{ title: "The curse of knowledge", url: "https://hbr.org/2006/12/the-curse-of-knowledge" }],
  jargonOpening: false,
  delivery: null,
};

function reply(body: unknown, stop_reason = "end_turn", model = "claude-opus-5-5") {
  return {
    model,
    stop_reason,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function stubClient(...replies: unknown[]) {
  const create = vi.fn();
  for (const r of replies) create.mockResolvedValueOnce(r);
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

describe("gradeAnswer", () => {
  it("asks Opus with no tools and the type's rubric", async () => {
    const { client, create } = stubClient(reply(card));
    const out = await gradeAnswer(client, input);
    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect("tools" in req).toBe(false);
    expect(JSON.stringify(req.system)).toContain(JSON.stringify(graderSystem("explain")).slice(1, 60));
    expect(out.card.grade).toBe("B+");
    expect(out.model).toBe("claude-opus-5-5");
    expect(create.mock.calls[0][1]).toEqual({ timeout: 50_000, maxRetries: 0 });
  });

  it("never carries a minutes field from Claude into the card", async () => {
    const { client } = stubClient(reply({ ...card, minutes: 60 }));
    const out = await gradeAnswer(client, input);
    expect("minutes" in out.card).toBe(false);
  });

  it("rejects an unknown grade as a schema error, carrying what the call cost", async () => {
    const { client } = stubClient(reply({ ...card, grade: "A+" }));
    await expect(gradeAnswer(client, input)).rejects.toMatchObject({
      reason: "schema",
      charge: { model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 50 } },
    });
  });

  it("treats a refusal as a refusal error", async () => {
    const { client } = stubClient(reply("", "refusal"));
    await expect(gradeAnswer(client, input)).rejects.toBeInstanceOf(GradeError);
    const again = stubClient(reply("", "refusal"));
    await expect(gradeAnswer(again.client, input)).rejects.toMatchObject({ reason: "refusal" });
  });

  it("reports an API failure as an api error", async () => {
    const create = vi.fn().mockRejectedValue(new Error("overloaded"));
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    await expect(gradeAnswer(client, input)).rejects.toMatchObject({ reason: "api" });
  });
});

describe("judgeTakeaway", () => {
  it("asks Haiku and returns its verdict", async () => {
    const { client, create } = stubClient(reply({ accepted: true, feedback: "Specific and from the article." }, "end_turn", "claude-haiku-5-5"));
    const out = await judgeTakeaway(client, {
      title: "The curse of knowledge",
      url: "https://hbr.org/2006/12/the-curse-of-knowledge",
      summary: "Experts forget what it was like not to know.",
      takeaway: "Tappers guess 50% of listeners know the song; really 2.5% do.",
      excerpt: "In the study, tappers predicted half of listeners would name the song. Only 2.5% did.",
    });
    expect(create.mock.calls[0][0].model).toBe("claude-haiku-5-5");
    expect(JSON.stringify(create.mock.calls[0][0].messages)).toContain("Only 2.5% did.");
    expect(out.accepted).toBe(true);
    expect(out.model).toBe("claude-haiku-5-5");
  });
});
