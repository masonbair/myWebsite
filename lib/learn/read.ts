import type { SupabaseClient } from "@supabase/supabase-js";
import { TOPIC_NAMES, type AnswerStatus, type Grade, type LearnType, type ReportCard, type TopicSlug } from "./types";

export type LearnReport = ReportCard & { minutes: number; late: boolean };

export type LearnCardView = {
  exerciseId: string;
  position: number;
  type: LearnType;
  topicName: string;
  question: string;
  client: string | null;
  reading: {
    title: string;
    url: string;
    summary: string;
    why: string | null;
    takeaway: { accepted: boolean; feedback: string; minutes: number } | null;
  };
  answer: null | { kind: "typed" | "voice"; status: AnswerStatus; report: LearnReport | null };
};

export type LearnDay = { date: string; cards: LearnCardView[]; earned: number };

export type LearnDayRows = {
  exercises: {
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
  }[];
  answers: { id: string; exercise_id: string; kind: "typed" | "voice"; status: AnswerStatus }[];
  grades: {
    answer_id: string;
    grade: Grade;
    worked: string;
    fix: string;
    better: string;
    resources: { title: string; url: string }[];
    jargon_opening: boolean | null;
    delivery: string | null;
    minutes: number;
    late: boolean;
  }[];
  readings: { exercise_id: string; accepted: boolean; feedback: string; minutes: number }[];
  grantMinutes: number[];
};

export function toLearnDay(date: string, rows: LearnDayRows): LearnDay {
  const answerOf = new Map(rows.answers.map((a) => [a.exercise_id, a]));
  const gradeOf = new Map(rows.grades.map((g) => [g.answer_id, g]));
  const readingOf = new Map(rows.readings.map((r) => [r.exercise_id, r]));
  const cards = [...rows.exercises]
    .sort((a, b) => a.position - b.position)
    .map((e): LearnCardView => {
      const answer = answerOf.get(e.id);
      const grade = answer ? gradeOf.get(answer.id) : undefined;
      const reading = readingOf.get(e.id);
      return {
        exerciseId: e.id,
        position: e.position,
        type: e.type,
        topicName: TOPIC_NAMES[e.topic],
        question: e.question,
        client: e.client,
        reading: {
          title: e.reading_title,
          url: e.reading_url,
          summary: e.reading_summary,
          why: e.reading_why,
          takeaway: reading ? { accepted: reading.accepted, feedback: reading.feedback, minutes: reading.minutes } : null,
        },
        answer: answer
          ? {
              kind: answer.kind,
              status: answer.status,
              report: grade
                ? {
                    grade: grade.grade,
                    worked: grade.worked,
                    fix: grade.fix,
                    better: grade.better,
                    resources: grade.resources,
                    jargonOpening: grade.jargon_opening,
                    delivery: grade.delivery,
                    minutes: grade.minutes,
                    late: grade.late,
                  }
                : null,
            }
          : null,
      };
    });
  return { date, cards, earned: rows.grantMinutes.reduce((s, m) => s + m, 0) };
}

/** Today's cards for the hub page, read through Mason's own session (RLS lets only the owner see them). */
export async function loadLearnDay(client: SupabaseClient, date: string): Promise<LearnDay> {
  const ex = await client
    .from("learn_exercises")
    .select("id, date, position, type, topic, question, client, reading_title, reading_url, reading_summary, reading_why")
    .eq("date", date);
  if (ex.error) throw ex.error;
  const exerciseIds = (ex.data ?? []).map((e) => e.id as string);
  const [answers, readings, grants] = await Promise.all([
    client.from("learn_answers").select("id, exercise_id, kind, status").in("exercise_id", exerciseIds),
    client.from("learn_readings").select("exercise_id, accepted, feedback, minutes").in("exercise_id", exerciseIds),
    client.from("learn_grants").select("minutes").eq("date", date),
  ]);
  for (const r of [answers, readings, grants]) if (r.error) throw r.error;
  const answerIds = (answers.data ?? []).map((a) => a.id as string);
  const grades = await client
    .from("learn_grades")
    .select("answer_id, grade, worked, fix, better, resources, jargon_opening, delivery, minutes, late")
    .in("answer_id", answerIds);
  if (grades.error) throw grades.error;
  return toLearnDay(date, {
    exercises: (ex.data ?? []) as LearnDayRows["exercises"],
    answers: (answers.data ?? []) as LearnDayRows["answers"],
    grades: (grades.data ?? []) as LearnDayRows["grades"],
    readings: (readings.data ?? []) as LearnDayRows["readings"],
    grantMinutes: (grants.data ?? []).map((g) => Number(g.minutes)),
  });
}
