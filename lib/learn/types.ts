export type LearnType = "scenario" | "explain" | "voice";
export type TopicSlug = "value" | "products" | "communication" | "explain-simply";

export const TOPIC_NAMES: Record<TopicSlug, string> = {
  value: "Understanding value",
  products: "Building great products",
  communication: "Communication",
  "explain-simply": "Explaining technical things simply",
};

export type Grade = "A" | "A-" | "B+" | "B" | "B-" | "C" | "D" | "F";
export const GRADES: readonly Grade[] = ["A", "A-", "B+", "B", "B-", "C", "D", "F"];

export type ReportCard = {
  grade: Grade;
  worked: string;
  fix: string;
  better: string;
  resources: { title: string; url: string }[];
  jargonOpening: boolean | null;
  delivery: string | null;
};

export type SignedGrant = { date: string; minutes: number; nonce: string; msg: string; sig: string };

export type AnswerStatus = "grading" | "awaiting_transcript" | "transcribed" | "graded" | "failed";

export const DAILY_CAP_MINUTES = 10;
export const READING_MINUTES = 1;
export const FOCUSLOCK_PACKAGE = "com.instagram.android";
export const HUB_LEARN_URL = "https://masonbair.com/hub/learn";
