import type Anthropic from "@anthropic-ai/sdk";
import type { IdeaReview } from "@/lib/ideas/types";

export const OTHER = "00000000-0000-4000-8000-000000000002";

export type FakeReply = {
  model?: string;
  stop_reason: string;
  content: Record<string, unknown>[];
  usage?: Record<string, unknown>;
};

export const usage = (input = 1000, output = 500, searches = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  server_tool_use: searches ? { web_search_requests: searches } : null,
});

export const textReply = (text: string, stop_reason = "end_turn", model = "claude-opus-5-5"): FakeReply => ({
  model,
  stop_reason,
  content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
  usage: usage(),
});

/** Stands in for client.beta.messages.stream(); each call takes the next canned reply and records its params. */
export function fakeAnthropic(replies: FakeReply[]) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          sent.push(structuredClone(params));
          const reply = replies.shift();
          if (!reply) throw new Error("fake anthropic: no reply left");
          return { finalMessage: async () => ({ usage: usage(), ...reply }) };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, sent };
}

export function validReview(overrides: Partial<IdeaReview> = {}): IdeaReview {
  return {
    verdict: "promising",
    why: "Bakers want it.",
    audience: "Home sourdough bakers",
    existing: [{ name: "Bread Timer", url: "https://breadtimer.example", difference: "No starter tracking" }],
    fromMemoryOnly: false,
    weakSpots: [
      { problem: "Small market", fix: "Sell to bakeries" },
      { problem: "Timers exist", fix: "Track the starter" },
    ],
    variations: ["A starter log", "A bakery planner"],
    weekend: { build: "An Expo timer", signal: "Ten bakers use it twice" },
    links: [{ ideaId: OTHER, how: "Both are about baking" }],
    ...overrides,
  };
}
