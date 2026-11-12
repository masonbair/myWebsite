import { LearnCapError, type Answer, type Exercise, type LearnStore, type SavedCard } from "@/lib/learn/store";
import type { SignedGrant } from "@/lib/learn/types";

/** An in-memory LearnStore that records every save, for award and job tests. */
export class FakeLearnStore implements LearnStore {
  exercises = new Map<string, Exercise>();
  answers = new Map<string, Answer>();
  grades = new Map<string, SavedCard>();
  readings = new Map<string, { takeaway: string; accepted: boolean; feedback: string; minutes: number }>();
  grants: (SignedGrant & { answerId?: string; exerciseId?: string })[] = [];
  failed: { id: string; error: string }[] = [];
  usage: unknown[] = [];
  spent = 0;
  extraGranted = 0;
  saveGradeCalls: { answerId: string; card: SavedCard; grant: SignedGrant | null }[] = [];
  /** When set, the next saveGrade throws the cap error and then runs this (e.g. to add minutes granted elsewhere). */
  capOnNextSave: (() => void) | null = null;

  addExercise(e: Partial<Exercise> & { id: string; date: string }): Exercise {
    const full: Exercise = {
      position: 1,
      type: "explain",
      topic: "explain-simply",
      question: "Explain a server to a florist.",
      client: null,
      readingTitle: "The curse of knowledge",
      readingUrl: "https://hbr.org/2006/12/the-curse-of-knowledge",
      readingSummary: "Experts forget what it was like not to know.",
      readingWhy: null,
      model: "claude-sonnet-5-5",
      ...e,
    };
    this.exercises.set(full.id, full);
    return full;
  }

  addAnswer(a: Partial<Answer> & { id: string; exerciseId: string }): Answer {
    const full: Answer = {
      kind: "typed",
      body: "A server is a computer that waits for requests.",
      clipPath: null,
      clipMime: null,
      clipDurationMs: null,
      transcript: null,
      status: "grading",
      attempts: 0,
      lastError: null,
      ...a,
    };
    this.answers.set(full.id, full);
    return full;
  }

  async exercisesFor(date: string) {
    return [...this.exercises.values()].filter((e) => e.date === date).sort((a, b) => a.position - b.position);
  }
  async exerciseById(id: string) {
    return this.exercises.get(id) ?? null;
  }
  async recentQuestions() {
    return [...this.exercises.values()].map((e) => ({ question: e.question, readingUrl: e.readingUrl }));
  }
  async insertExercises(rows: Omit<Exercise, "id">[]) {
    if (rows.some((r) => [...this.exercises.values()].some((e) => e.date === r.date && e.position === r.position))) return "exists" as const;
    for (const r of rows) this.addExercise({ ...r, id: `ex-${this.exercises.size + 1}` });
    return "ok" as const;
  }
  async loadAnswer(id: string) {
    const answer = this.answers.get(id);
    if (!answer) return null;
    return { answer, exercise: this.exercises.get(answer.exerciseId)! };
  }
  async insertAnswer(row: Parameters<LearnStore["insertAnswer"]>[0]) {
    if ([...this.answers.values()].some((a) => a.exerciseId === row.exerciseId)) return "duplicate" as const;
    const id = row.id ?? `ans-${this.answers.size + 1}`;
    this.addAnswer(
      row.kind === "typed"
        ? { id, exerciseId: row.exerciseId, kind: "typed", body: row.body }
        : {
            id,
            exerciseId: row.exerciseId,
            kind: "voice",
            body: null,
            clipPath: row.clipPath,
            clipMime: row.clipMime,
            clipDurationMs: row.clipDurationMs,
            status: "awaiting_transcript",
          },
    );
    return { id };
  }
  async grantedMinutes(date: string) {
    return this.grants.filter((g) => g.date === date).reduce((s, g) => s + g.minutes, 0) + this.extraGranted;
  }
  async saveGrade(answerId: string, card: SavedCard, grant: SignedGrant | null) {
    this.saveGradeCalls.push({ answerId, card, grant });
    if (this.capOnNextSave) {
      const after = this.capOnNextSave;
      this.capOnNextSave = null;
      after();
      throw new LearnCapError("learn grants would pass the daily cap of 10 minutes");
    }
    if (this.grades.has(answerId)) return "duplicate" as const;
    this.grades.set(answerId, card);
    if (grant) this.grants.push({ ...grant, answerId });
    this.answers.get(answerId)!.status = "graded";
    return "ok" as const;
  }
  async readingExists(exerciseId: string) {
    return this.readings.has(exerciseId);
  }
  async saveTakeaway(exerciseId: string, v: { takeaway: string; accepted: boolean; feedback: string; minutes: number }, grant: SignedGrant | null) {
    if (this.readings.has(exerciseId)) return "duplicate" as const;
    this.readings.set(exerciseId, v);
    if (grant) this.grants.push({ ...grant, exerciseId });
    return "ok" as const;
  }
  async markFailed(id: string, error: string) {
    this.failed.push({ id, error });
    const a = this.answers.get(id);
    if (a) {
      a.status = "failed";
      a.attempts += 1;
      a.lastError = error;
    }
  }
  async answersToRetry() {
    return [...this.answers.values()].filter((a) => a.status === "transcribed" || a.status === "failed" || a.status === "grading").map((a) => a.id);
  }
  async pendingClips() {
    return [...this.answers.values()]
      .filter((a) => a.kind === "voice" && a.status === "awaiting_transcript" && a.transcript === null)
      .map((a) => ({ id: a.id, path: a.clipPath!, mime: a.clipMime! }));
  }
  async attachTranscript(id: string, text: string) {
    const a = this.answers.get(id);
    if (!a || a.kind !== "voice") return "missing" as const;
    if (a.transcript !== null) return "duplicate" as const;
    a.transcript = text;
    a.status = "transcribed";
    return "ok" as const;
  }
  async clipUrl(path: string) {
    return `https://storage.test/${path}?token=signed`;
  }
  async clipExists() {
    return true;
  }
  async grantsFor(date: string) {
    return this.grants.filter((g) => g.date === date).map(({ msg, sig }) => ({ msg, sig }));
  }
  async spend() {
    return this.spent;
  }
  async recordUsage(row: unknown) {
    this.usage.push(row);
    return 0.01;
  }
}
