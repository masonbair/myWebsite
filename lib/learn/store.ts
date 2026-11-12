import type { SupabaseClient } from "@supabase/supabase-js";
import { recordUsage, type UsageRow } from "@/lib/ai/claude";
import { learnSpend } from "./budget";
import type { AnswerStatus, LearnType, ReportCard, SignedGrant, TopicSlug } from "./types";

const BUCKET = "learn-voice";
const RETRY_AFTER_MS = 2 * 60_000;

export type Exercise = {
  id: string;
  date: string;
  position: number;
  type: LearnType;
  topic: TopicSlug;
  question: string;
  client: string | null;
  readingTitle: string;
  readingUrl: string;
  readingSummary: string;
  readingWhy: string | null;
  /** Start of the article text, saved at generation so the takeaway check can see what the article says. */
  readingExcerpt: string | null;
  model: string;
};
export type NewExercise = Omit<Exercise, "id">;

export type Answer = {
  id: string;
  exerciseId: string;
  kind: "typed" | "voice";
  body: string | null;
  clipPath: string | null;
  clipMime: string | null;
  clipDurationMs: number | null;
  transcript: string | null;
  status: AnswerStatus;
  attempts: number;
  lastError: string | null;
};
export type NewAnswer =
  | { id?: string; exerciseId: string; kind: "typed"; body: string }
  | { id?: string; exerciseId: string; kind: "voice"; clipPath: string; clipMime: string; clipDurationMs: number };

export type SavedCard = ReportCard & { minutes: number; late: boolean; model: string | null };

/** The trigger in 0014 refused a grant because the day would pass the 10-minute cap. */
export class LearnCapError extends Error {}

export type LearnStore = {
  exercisesFor(date: string): Promise<Exercise[]>;
  exerciseById(id: string): Promise<Exercise | null>;
  readingExists(exerciseId: string): Promise<boolean>;
  /** Paid takeaway checks logged for this card; each is an ai_usage row with purpose takeaway:<exerciseId>. */
  takeawayAttempts(exerciseId: string): Promise<number>;
  recentQuestions(days: number, today: string): Promise<{ question: string; readingUrl: string }[]>;
  insertExercises(rows: NewExercise[]): Promise<"ok" | "exists">;
  loadAnswer(id: string): Promise<{ answer: Answer; exercise: Exercise } | null>;
  insertAnswer(row: NewAnswer): Promise<{ id: string } | "duplicate">;
  grantedMinutes(date: string): Promise<number>;
  saveGrade(answerId: string, card: SavedCard, grant: SignedGrant | null): Promise<"ok" | "duplicate">;
  saveTakeaway(
    exerciseId: string,
    v: { takeaway: string; accepted: boolean; feedback: string; minutes: number },
    grant: SignedGrant | null,
  ): Promise<"ok" | "duplicate">;
  markFailed(answerId: string, error: string): Promise<void>;
  answersToRetry(maxAttempts: number): Promise<string[]>;
  pendingClips(): Promise<{ id: string; path: string; mime: string }[]>;
  attachTranscript(id: string, text: string): Promise<"ok" | "duplicate" | "missing">;
  clipUrl(path: string, seconds: number): Promise<string>;
  clipExists(path: string): Promise<boolean>;
  grantsFor(date: string): Promise<{ msg: string; sig: string }[]>;
  spend(now: Date): Promise<number>;
  recordUsage(row: Omit<UsageRow, "feature">): Promise<number>;
};

type ExerciseRow = {
  id: string;
  date: string;
  position: number;
  type: LearnType;
  topic: TopicSlug;
  question: string;
  client: string | null;
  reading_title: string;
  reading_url: string;
  reading_summary: string;
  reading_why: string | null;
  reading_excerpt: string | null;
  model: string;
};
type AnswerRow = {
  id: string;
  exercise_id: string;
  kind: "typed" | "voice";
  body: string | null;
  clip_path: string | null;
  clip_mime: string | null;
  clip_duration_ms: number | null;
  transcript: string | null;
  status: AnswerStatus;
  attempts: number;
  last_error: string | null;
};

const toExercise = (r: ExerciseRow): Exercise => ({
  id: r.id,
  date: r.date,
  position: r.position,
  type: r.type,
  topic: r.topic,
  question: r.question,
  client: r.client,
  readingTitle: r.reading_title,
  readingUrl: r.reading_url,
  readingSummary: r.reading_summary,
  readingWhy: r.reading_why,
  readingExcerpt: r.reading_excerpt,
  model: r.model,
});

const toAnswer = (r: AnswerRow): Answer => ({
  id: r.id,
  exerciseId: r.exercise_id,
  kind: r.kind,
  body: r.body,
  clipPath: r.clip_path,
  clipMime: r.clip_mime,
  clipDurationMs: r.clip_duration_ms,
  transcript: r.transcript,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
});

const grantJson = (g: SignedGrant | null) =>
  g && { date: g.date, minutes: g.minutes, nonce: g.nonce, msg: g.msg, sig: g.sig };

function rpcError(error: { message: string }): Error {
  return error.message.includes("daily cap") ? new LearnCapError(error.message) : new Error(error.message);
}

const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";

/** Every learn read and write, through the service role; grades and grants only through the 0014 save functions. */
export function supabaseLearnStore(client: SupabaseClient): LearnStore {
  return {
    async exercisesFor(date) {
      const { data, error } = await client.from("learn_exercises").select("*").eq("date", date).order("position");
      if (error) throw error;
      return (data as ExerciseRow[]).map(toExercise);
    },

    async exerciseById(id) {
      const { data, error } = await client.from("learn_exercises").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? toExercise(data as ExerciseRow) : null;
    },

    async readingExists(exerciseId) {
      const { count, error } = await client
        .from("learn_readings")
        .select("exercise_id", { count: "exact", head: true })
        .eq("exercise_id", exerciseId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },

    async takeawayAttempts(exerciseId) {
      const { count, error } = await client
        .from("ai_usage")
        .select("id", { count: "exact", head: true })
        .eq("feature", "learn")
        .eq("purpose", `takeaway:${exerciseId}`);
      if (error) throw error;
      return count ?? 0;
    },

    async recentQuestions(days, today) {
      const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await client
        .from("learn_exercises")
        .select("question, reading_url")
        .gte("date", since)
        .lt("date", today)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({ question: r.question as string, readingUrl: r.reading_url as string }));
    },

    async insertExercises(rows) {
      const { error } = await client.from("learn_exercises").insert(
        rows.map((r) => ({
          date: r.date,
          position: r.position,
          type: r.type,
          topic: r.topic,
          question: r.question,
          client: r.client,
          reading_title: r.readingTitle,
          reading_url: r.readingUrl,
          reading_summary: r.readingSummary,
          reading_why: r.readingWhy,
          reading_excerpt: r.readingExcerpt,
          model: r.model,
        })),
      );
      if (isUniqueViolation(error)) return "exists";
      if (error) throw error;
      return "ok";
    },

    async loadAnswer(id) {
      const { data, error } = await client.from("learn_answers").select("*, learn_exercises(*)").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { learn_exercises: exercise, ...answer } = data as AnswerRow & { learn_exercises: ExerciseRow };
      return { answer: toAnswer(answer), exercise: toExercise(exercise) };
    },

    async insertAnswer(row) {
      const base = { ...(row.id ? { id: row.id } : {}), exercise_id: row.exerciseId, kind: row.kind };
      const values: Record<string, unknown> =
        row.kind === "typed"
          ? { ...base, body: row.body, status: "grading" }
          : {
              ...base,
              clip_path: row.clipPath,
              clip_mime: row.clipMime,
              clip_duration_ms: row.clipDurationMs,
              status: "awaiting_transcript",
            };
      const { data, error } = await client.from("learn_answers").insert(values).select("id").single();
      if (isUniqueViolation(error)) return "duplicate";
      if (error) throw error;
      return { id: data.id as string };
    },

    async grantedMinutes(date) {
      const { data, error } = await client.from("learn_grants").select("minutes").eq("date", date);
      if (error) throw error;
      return (data ?? []).reduce((sum, r) => sum + Number(r.minutes), 0);
    },

    async saveGrade(answerId, card, grant) {
      const { data, error } = await client.rpc("learn_save_grade", {
        p_answer_id: answerId,
        p_grade: {
          grade: card.grade,
          worked: card.worked,
          fix: card.fix,
          better: card.better,
          resources: card.resources,
          jargon_opening: card.jargonOpening,
          delivery: card.delivery,
          minutes: card.minutes,
          late: card.late,
          model: card.model,
        },
        p_grant: grantJson(grant),
      });
      if (error) throw rpcError(error);
      return data as "ok" | "duplicate";
    },

    async saveTakeaway(exerciseId, v, grant) {
      const { data, error } = await client.rpc("learn_save_takeaway", {
        p_exercise_id: exerciseId,
        p_takeaway: v.takeaway,
        p_accepted: v.accepted,
        p_feedback: v.feedback,
        p_minutes: v.minutes,
        p_grant: grantJson(grant),
      });
      if (error) throw rpcError(error);
      return data as "ok" | "duplicate";
    },

    async markFailed(answerId, message) {
      const { error } = await client.rpc("learn_mark_failed", { p_id: answerId, p_error: message });
      if (error) throw error;
    },

    async answersToRetry(maxAttempts) {
      const before = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
      const { data, error } = await client
        .from("learn_answers")
        .select("id")
        // An answer held by the monthly cap waits until spend resets, however many runs found the cap still reached.
        .or(
          `status.eq.transcribed,and(status.eq.failed,last_error.eq.cap),and(status.in.(failed,grading),attempts.lt.${maxAttempts},updated_at.lt.${before})`,
        )
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((r) => r.id as string);
    },

    async pendingClips() {
      const { data, error } = await client
        .from("learn_answers")
        .select("id, clip_path, clip_mime")
        .eq("kind", "voice")
        .eq("status", "awaiting_transcript")
        .is("transcript", null)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id as string, path: r.clip_path as string, mime: r.clip_mime as string }));
    },

    async attachTranscript(id, text) {
      const { data, error } = await client.rpc("learn_attach_transcript", { p_id: id, p_text: text });
      if (error) throw error;
      return data as "ok" | "duplicate" | "missing";
    },

    async clipUrl(path, seconds) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, seconds);
      if (error) throw error;
      return data.signedUrl;
    },

    async clipExists(path) {
      const slash = path.lastIndexOf("/");
      const { data, error } = await client.storage.from(BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1) });
      if (error) throw error;
      return (data ?? []).some((f) => f.name === path.slice(slash + 1));
    },

    async grantsFor(date) {
      const { data, error } = await client.from("learn_grants").select("msg, sig").eq("date", date).order("created_at");
      if (error) throw error;
      return (data ?? []).map((r) => ({ msg: r.msg as string, sig: r.sig as string }));
    },

    spend: (now) => learnSpend(client, now),
    recordUsage: (row) => recordUsage(client, { ...row, feature: "learn" }),
  };
}
