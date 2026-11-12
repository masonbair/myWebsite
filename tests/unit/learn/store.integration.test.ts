import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { signGrant, signingKey } from "@/lib/learn/grant";
import { supabaseLearnStore, type NewExercise } from "@/lib/learn/store";

// Run with: LEARN_TEST_DB=1 LEARN_TEST_SUPABASE_URL=http://127.0.0.1:<port> LEARN_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Learn rows can never be deleted, so every run uses its own far-future dates and refuses anything but a local stack.
const enabled = Boolean(process.env.LEARN_TEST_DB);
const apiUrl = process.env.LEARN_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.LEARN_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("LEARN_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

function freshDate(): string {
  const day = new Date(Date.UTC(2200, 0, 1) + Math.floor(Math.random() * 300 * 365) * 86_400_000);
  return day.toISOString().slice(0, 10);
}

function exercise(date: string, position: 1 | 2, type: NewExercise["type"]): NewExercise {
  return {
    date,
    position,
    type,
    topic: type === "voice" ? "communication" : "explain-simply",
    question: "Explain what a server is to a florist.",
    client: null,
    readingTitle: "The curse of knowledge",
    readingUrl: "https://hbr.org/2006/12/the-curse-of-knowledge",
    readingSummary: "Experts forget what it was like not to know.",
    readingWhy: null,
    model: "claude-sonnet-5-5",
  };
}

function key() {
  const pkcs8 = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" });
  return signingKey(pkcs8.subarray(pkcs8.length - 32).toString("base64"))!;
}

describe.skipIf(!enabled)("supabaseLearnStore against local Supabase", () => {
  const store = () => supabaseLearnStore(createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));

  it("inserts a day's exercises once", async () => {
    const date = freshDate();
    const rows = [exercise(date, 1, "explain"), exercise(date, 2, "scenario")];
    expect(await store().insertExercises(rows)).toBe("ok");
    expect(await store().insertExercises(rows)).toBe("exists");
    expect((await store().exercisesFor(date)).map((e) => e.position)).toEqual([1, 2]);
  });

  it("saves a grade with its grant and serves only msg and sig for that date", async () => {
    const date = freshDate();
    await store().insertExercises([exercise(date, 1, "explain")]);
    const [ex] = await store().exercisesFor(date);
    const answer = await store().insertAnswer({ exerciseId: ex.id, kind: "typed", body: "A server is a computer that waits for requests." });
    if (answer === "duplicate") throw new Error("unexpected duplicate");
    expect(await store().insertAnswer({ exerciseId: ex.id, kind: "typed", body: "again" })).toBe("duplicate");

    const grant = signGrant(key(), date, 4);
    const card = { grade: "A" as const, worked: "Plain words.", fix: "Check they followed.", better: "Better.", resources: [], jargonOpening: false, delivery: null };
    expect(await store().saveGrade(answer.id, { ...card, minutes: 4, late: false, model: "claude-opus-5-5" }, grant)).toBe("ok");
    expect(await store().saveGrade(answer.id, { ...card, minutes: 4, late: false, model: "claude-opus-5-5" }, null)).toBe("duplicate");
    expect(await store().grantsFor(date)).toEqual([{ msg: grant.msg, sig: grant.sig }]);
    expect(await store().grantedMinutes(date)).toBe(4);
    expect((await store().loadAnswer(answer.id))?.answer.status).toBe("graded");
  });

  it("lists a voice clip until its transcript lands, once", async () => {
    const date = freshDate();
    await store().insertExercises([exercise(date, 2, "voice")]);
    const [ex] = await store().exercisesFor(date);
    const id = randomUUID();
    const answer = await store().insertAnswer({
      id,
      exerciseId: ex.id,
      kind: "voice",
      clipPath: `answers/${id}.webm`,
      clipMime: "audio/webm",
      clipDurationMs: 42_000,
    });
    expect(answer).toEqual({ id });
    expect((await store().pendingClips()).map((c) => c.id)).toContain(id);

    expect(await store().attachTranscript(id, "So um the launch moves a week.")).toBe("ok");
    expect(await store().attachTranscript(id, "again")).toBe("duplicate");
    expect(await store().attachTranscript(randomUUID(), "x")).toBe("missing");
    expect((await store().pendingClips()).map((c) => c.id)).not.toContain(id);
  });
});
