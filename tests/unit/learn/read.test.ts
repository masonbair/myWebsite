import { describe, expect, it } from "vitest";
import { toLearnDay, type LearnDayRows } from "@/lib/learn/read";

const rows: LearnDayRows = {
  exercises: [
    {
      id: "ex2",
      date: "2026-11-13",
      position: 2,
      type: "scenario",
      topic: "value",
      question: "What job is the gym owner hiring the app for?",
      client: null,
      reading_title: "Jobs to be done",
      reading_url: "https://hbr.org/2016/09/know-your-customers-jobs-to-be-done",
      reading_summary: "People hire products to get a job done.",
      reading_why: "It is the base for today's question.",
    },
    {
      id: "ex1",
      date: "2026-11-13",
      position: 1,
      type: "explain",
      topic: "explain-simply",
      question: "Explain DNS to a baker.",
      client: "Rosa, who runs a bakery",
      reading_title: "The curse of knowledge",
      reading_url: "https://hbr.org/2006/12/the-curse-of-knowledge",
      reading_summary: "Experts forget what it was like not to know.",
      reading_why: null,
    },
  ],
  answers: [{ id: "a1", exercise_id: "ex1", kind: "typed", status: "graded" }],
  grades: [
    {
      answer_id: "a1",
      grade: "B+",
      worked: "Led with the outcome.",
      fix: "Drop the acronym.",
      better: "Better.",
      resources: [{ title: "R", url: "https://example.com/r" }],
      jargon_opening: false,
      delivery: null,
      minutes: 3,
      late: false,
    },
  ],
  readings: [{ exercise_id: "ex2", accepted: true, feedback: "Specific.", minutes: 1 }],
  grantMinutes: [3, 1],
};

describe("toLearnDay", () => {
  it("orders cards by position, merges the report and the takeaway, and sums the day's minutes", () => {
    const day = toLearnDay("2026-11-13", rows);
    expect(day.earned).toBe(4);
    expect(day.cards.map((c) => c.exerciseId)).toEqual(["ex1", "ex2"]);
    expect(day.cards[0]).toMatchObject({
      topicName: "Explaining technical things simply",
      client: "Rosa, who runs a bakery",
      answer: { kind: "typed", status: "graded", report: { grade: "B+", minutes: 3, late: false, jargonOpening: false } },
      reading: { takeaway: null },
    });
    expect(day.cards[1]).toMatchObject({
      answer: null,
      reading: { title: "Jobs to be done", takeaway: { accepted: true, feedback: "Specific.", minutes: 1 } },
    });
  });
});
