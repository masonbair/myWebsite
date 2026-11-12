import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { dayPlan } from "@/lib/learn/day";
import { GenerateError, generateExercises } from "@/lib/learn/generate";

const plan = dayPlan("2026-11-14");

function text(body: unknown, stop_reason = "end_turn") {
  return {
    model: "claude-sonnet-5-5",
    stop_reason,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    usage: { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 2 } },
  };
}

function exercises(urls: [string, string], explainClient: string | null = "Rosa, who runs a bakery and wonders why her site was slow") {
  return {
    exercises: [
      {
        question: "Rosa asks why her website was down for an hour after the move. Explain it in three sentences.",
        client: explainClient,
        reading: { title: "The curse of knowledge", url: urls[0], summary: "Experts forget what it was like not to know.", why: "You open with tool names." },
      },
      {
        question: "Record a one-minute voice note telling a client their launch slips a week.",
        client: null,
        reading: { title: "How to deliver bad news", url: urls[1], summary: "Lead with the news, then the plan.", why: "Clients trust a clear plan." },
      },
    ],
  };
}

function stub(...replies: unknown[]) {
  const create = vi.fn();
  for (const r of replies) create.mockResolvedValueOnce(r);
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const okFetch = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
const fetchBy = (bad: Set<string>) => vi.fn(async (url: string) => new Response("", { status: bad.has(url) ? 404 : 200 })) as unknown as typeof fetch;

describe("generateExercises", () => {
  it("searches, then formats two rows for the day's plan", async () => {
    const { client, create } = stub(text("notes about readings"), text(exercises(["https://a.test/1", "https://a.test/2"])));
    const charges: unknown[] = [];
    const out = await generateExercises(client, "2026-11-14", plan, [], okFetch, async (c) => void charges.push(c));
    expect(out.rows.map((r) => [r.position, r.type, r.topic])).toEqual([
      [1, "explain", "explain-simply"],
      [2, "voice", "communication"],
    ]);
    expect(out.rows[0].date).toBe("2026-11-14");
    expect(create.mock.calls[0][0].tools?.[0]?.name).toBe("web_search");
    expect(create.mock.calls[1][0].output_config.format.type).toBe("json_schema");
    expect(charges).toHaveLength(2);
  });

  it("asks once more when a reading URL is dead", async () => {
    const { client, create } = stub(
      text("notes"),
      text(exercises(["https://dead.test/1", "https://a.test/2"])),
      text(exercises(["https://a.test/3", "https://a.test/2"])),
    );
    const out = await generateExercises(client, "2026-11-14", plan, [], fetchBy(new Set(["https://dead.test/1"])), async () => {});
    expect(create).toHaveBeenCalledTimes(3);
    expect(out.rows[0].readingUrl).toBe("https://a.test/3");
  });

  it("gives up after a second dead reading", async () => {
    const { client } = stub(
      text("notes"),
      text(exercises(["https://dead.test/1", "https://a.test/2"])),
      text(exercises(["https://dead.test/1", "https://a.test/2"])),
    );
    await expect(generateExercises(client, "2026-11-14", plan, [], fetchBy(new Set(["https://dead.test/1"])), async () => {})).rejects.toMatchObject({
      reason: "reading",
    });
  });

  it("treats a reading used in the last two weeks like a dead link", async () => {
    const { client } = stub(
      text("notes"),
      text(exercises(["https://used.test/1", "https://a.test/2"])),
      text(exercises(["https://used.test/1", "https://a.test/2"])),
    );
    await expect(
      generateExercises(client, "2026-11-14", plan, [{ question: "old", readingUrl: "https://used.test/1" }], okFetch, async () => {}),
    ).rejects.toBeInstanceOf(GenerateError);
  });

  it("refuses an explain exercise with no client", async () => {
    const { client } = stub(text("notes"), text(exercises(["https://a.test/1", "https://a.test/2"], null)));
    await expect(generateExercises(client, "2026-11-14", plan, [], okFetch, async () => {})).rejects.toMatchObject({ reason: "schema" });
  });

  it("logs the cost of every paid call even when generation fails afterwards", async () => {
    const charges: unknown[] = [];
    const { client } = stub(
      text("notes"),
      text(exercises(["https://dead.test/1", "https://a.test/2"])),
      text(exercises(["https://dead.test/1", "https://a.test/2"])),
    );
    await expect(
      generateExercises(client, "2026-11-14", plan, [], fetchBy(new Set(["https://dead.test/1"])), async (c) => void charges.push(c)),
    ).rejects.toMatchObject({ reason: "reading" });
    expect(charges).toHaveLength(3);
  });

  it("logs the cost of a refused call", async () => {
    const charges: unknown[] = [];
    const { client } = stub(text("", "refusal"));
    await expect(generateExercises(client, "2026-11-14", plan, [], okFetch, async (c) => void charges.push(c))).rejects.toMatchObject({
      reason: "refusal",
    });
    expect(charges).toHaveLength(1);
  });

  it("keeps a trimmed text excerpt of each reading for the takeaway check", async () => {
    const html = "<html><head><style>p{}</style></head><body><nav>Menu</nav><p>Tappers guessed half the listeners would know the song.</p><p>Only 2.5% did.</p></body></html>";
    const fetchHtml = vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const { client } = stub(text("notes"), text(exercises(["https://a.test/1", "https://a.test/2"])));
    const out = await generateExercises(client, "2026-11-14", plan, [], fetchHtml, async () => {});
    expect(out.rows[0].readingExcerpt).toContain("Tappers guessed half the listeners would know the song.");
    expect(out.rows[0].readingExcerpt).toContain("Only 2.5% did.");
    expect(out.rows[0].readingExcerpt!.length).toBeLessThanOrEqual(4000);
  });
});
