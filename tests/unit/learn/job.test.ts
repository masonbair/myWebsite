import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { runLearnJob, type LearnJobDeps } from "@/lib/learn/job";
import type { NewExercise } from "@/lib/learn/store";
import { FakeLearnStore } from "./fake-store";

const NOW = new Date("2026-11-14T10:30:00Z");

function row(position: 1 | 2): NewExercise {
  return {
    date: "2026-11-14",
    position,
    type: position === 1 ? "explain" : "voice",
    topic: position === 1 ? "explain-simply" : "communication",
    question: "Explain a server to a florist.",
    client: position === 1 ? "Ana, a florist" : null,
    readingTitle: "Reading",
    readingUrl: `https://a.test/${position}`,
    readingSummary: "Summary.",
    readingWhy: null,
    model: "claude-sonnet-5-5",
  };
}

function setup(overrides: Partial<LearnJobDeps> = {}) {
  const store = new FakeLearnStore();
  const generate = vi.fn(async (...args: unknown[]) => {
    const onCharge = args[5] as (c: { model: "claude-sonnet-5-5"; usage: { input_tokens: number; output_tokens: number } }) => Promise<void>;
    await onCharge({ model: "claude-sonnet-5-5", usage: { input_tokens: 1, output_tokens: 1 } });
    return { rows: [row(1), row(2)] };
  });
  const award = vi.fn(async () => ({ status: "duplicate" as const }));
  const deps: LearnJobDeps = {
    store,
    anthropic: {} as Anthropic,
    key: null,
    now: () => NOW,
    timeZone: "UTC",
    cap: 10,
    fetchFn: fetch,
    generate,
    award,
    ...overrides,
  };
  return { store, generate, award, deps };
}

describe("runLearnJob", () => {
  it("writes today's exercises when there are none", async () => {
    const { store, generate, deps } = setup();
    const out = await runLearnJob(deps);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await store.exercisesFor("2026-11-14")).map((e) => e.position)).toEqual([1, 2]);
    expect(out.generated).toBe(true);
    expect(store.usage).toHaveLength(1);
  });

  it("leaves a day that already has exercises", async () => {
    const { store, generate, deps } = setup();
    store.addExercise({ id: "ex1", date: "2026-11-14" });
    expect((await runLearnJob(deps)).generated).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("writes nothing at the monthly cap", async () => {
    const { store, generate, deps } = setup();
    store.spent = 10;
    await runLearnJob(deps);
    expect(generate).not.toHaveBeenCalled();
  });

  it("logs generation cost even when generation fails", async () => {
    const { store, deps } = setup({
      generate: vi.fn(async (...args: unknown[]) => {
        await (args[5] as (c: unknown) => Promise<void>)({ model: "claude-sonnet-5-5", usage: { input_tokens: 1, output_tokens: 1 } });
        throw new Error("dead links");
      }) as unknown as LearnJobDeps["generate"],
    });
    await expect(runLearnJob(deps)).resolves.toMatchObject({ generated: false });
    expect(store.usage).toHaveLength(1);
  });

  it("does not throw when a parallel run inserted first", async () => {
    const { store, deps } = setup();
    store.insertExercises = async () => "exists";
    await expect(runLearnJob(deps)).resolves.toMatchObject({ generated: false });
  });

  it("keeps grading the rest when one answer fails", async () => {
    const award = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: "graded", card: {}, minutes: 3, late: false });
    const { store, deps } = setup({ award });
    store.addExercise({ id: "ex1", date: "2026-11-14" });
    store.addAnswer({ id: "a1", exerciseId: "ex1", status: "failed" });
    store.addExercise({ id: "ex2", date: "2026-11-14", position: 2 });
    store.addAnswer({ id: "a2", exerciseId: "ex2", status: "transcribed", kind: "voice", transcript: "hi" });
    const out = await runLearnJob(deps);
    expect(award).toHaveBeenCalledTimes(2);
    expect(out.graded).toEqual(["a2"]);
  });
});
