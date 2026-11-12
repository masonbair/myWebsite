import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOwner } from "@/lib/auth/require-owner";
import { FakeLearnStore } from "./fake-store";

let requestHeaders: Record<string, string> = {};
let store: FakeLearnStore;
const award = vi.fn();
const takeaway = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers(requestHeaders)) }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwner: vi.fn(async () => ({ userId: "owner" })) }));
vi.mock("@/lib/learn/runtime", () => ({
  learnRuntime: vi.fn(async () => ({
    store,
    today: "2026-11-13",
    awardDeps: { store },
  })),
}));
vi.mock("@/lib/learn/award", () => ({
  gradeAndGrant: (...args: unknown[]) => award(...args),
  awardTakeaway: (...args: unknown[]) => takeaway(...args),
}));

const { sendTakeaway, sendTypedAnswer, sendVoiceAnswer } = await import("@/app/hub/learn-actions");

const EX = "3f2b8c1e-0d4a-4b7e-9a51-6c2f1d8e7a90";
const OLD = "9a2b8c1e-0d4a-4b7e-9a51-6c2f1d8e7a90";
const report = { grade: "A", worked: "w", fix: "f", better: "b", resources: [], jargonOpening: false, delivery: null };

describe("learn actions", () => {
  beforeEach(() => {
    requestHeaders = {};
    store = new FakeLearnStore();
    store.addExercise({ id: EX, date: "2026-11-13" });
    store.addExercise({ id: OLD, date: "2026-11-12" });
    award.mockReset().mockResolvedValue({ status: "graded", card: report, minutes: 4, late: false });
    takeaway.mockReset().mockResolvedValue({ status: "judged", accepted: true, feedback: "Specific.", minutes: 1 });
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(requireOwner).mockClear();
  });

  it("grades a typed answer and returns the report card", async () => {
    expect(await sendTypedAnswer(EX, "  A server waits for requests.  ")).toEqual({
      ok: true,
      status: "graded",
      report: { ...report, minutes: 4, late: false },
    });
    expect(requireOwner).toHaveBeenCalled();
    expect([...store.answers.values()][0]).toMatchObject({ kind: "typed", body: "A server waits for requests." });
    expect(revalidatePath).toHaveBeenCalledWith("/hub/learn");
  });

  it("refuses cross-origin calls and bad ids", async () => {
    requestHeaders = { origin: "https://evil.test", host: "masonbair.com" };
    expect(await sendTypedAnswer(EX, "x")).toEqual({ ok: false, error: "Bad request." });
    requestHeaders = {};
    expect(await sendTypedAnswer("abc", "x")).toEqual({ ok: false, error: "Bad request." });
    expect(store.answers.size).toBe(0);
  });

  it("refuses a card from another day and writes nothing", async () => {
    expect(await sendTypedAnswer(OLD, "x")).toEqual({ ok: false, error: "This card is from another day." });
    expect(store.answers.size).toBe(0);
  });

  it("refuses a second answer", async () => {
    await sendTypedAnswer(EX, "first");
    expect(await sendTypedAnswer(EX, "second")).toEqual({ ok: false, error: "Already answered." });
  });

  it("refuses empty and too-long answers", async () => {
    expect((await sendTypedAnswer(EX, "   ")).ok).toBe(false);
    expect((await sendTypedAnswer(EX, "x".repeat(8001))).ok).toBe(false);
    expect(store.answers.size).toBe(0);
  });

  it("maps waiting reasons to plain copy", async () => {
    award.mockResolvedValueOnce({ status: "waiting", reason: "cap" });
    expect(await sendTypedAnswer(EX, "x")).toEqual({
      ok: true,
      status: "pending",
      message: "The monthly AI budget is used up. Your answer is saved and will be graded next month.",
    });
  });

  it("saves a voice clip only at this card's own path, with a sane length, once it exists", async () => {
    const good = { path: `answers/${EX}.webm`, mime: "audio/webm", durationMs: 42_000 };
    for (const bad of [
      { ...good, path: `answers/${OLD}.webm` },
      { ...good, path: `answers/../${EX}.webm` },
      { ...good, durationMs: 500 },
      { ...good, durationMs: 400_000 },
      { ...good, mime: "audio/wav" },
    ]) {
      expect((await sendVoiceAnswer(EX, bad)).ok).toBe(false);
    }
    store.clipExists = async () => false;
    expect((await sendVoiceAnswer(EX, good)).ok).toBe(false);
    expect(store.answers.size).toBe(0);

    store.clipExists = async () => true;
    expect(await sendVoiceAnswer(EX, { ...good, grade: "A", minutes: 60 } as typeof good)).toEqual({ ok: true, status: "pending", message: "Graded soon." });
    expect([...store.answers.values()][0]).toMatchObject({ kind: "voice", clipPath: good.path, clipDurationMs: 42_000, status: "awaiting_transcript" });
    expect(award).not.toHaveBeenCalled();
  });

  it("judges a takeaway for today's card", async () => {
    expect(await sendTakeaway(EX, "Tappers think half know the song; 2.5% do.")).toEqual({
      ok: true,
      accepted: true,
      feedback: "Specific.",
      minutes: 1,
    });
    expect(await sendTakeaway(OLD, "x")).toEqual({ ok: false, error: "This card is from another day." });
    expect((await sendTakeaway(EX, "x".repeat(501))).ok).toBe(false);
  });
});
