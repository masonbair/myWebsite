import { z } from "zod";

export const PROMPT_VERSION = "review-v1";

/** Matches the length check on idea_settings.review_note. */
export const MAX_REVIEW_NOTE = 2000;

export const REVIEW_SCHEMA = z.object({
  verdict: z.enum(["strong", "promising", "needs work", "weak"]),
  why: z.string(),
  audience: z.string(),
  existing: z
    .array(z.object({ name: z.string(), url: z.string().nullable(), difference: z.string() }))
    .max(5),
  fromMemoryOnly: z.boolean(),
  weakSpots: z.array(z.object({ problem: z.string(), fix: z.string() })).min(2).max(4),
  variations: z.array(z.string()).min(2).max(3),
  weekend: z.object({ build: z.string(), signal: z.string() }),
  links: z.array(z.object({ ideaId: z.string(), how: z.string() })).max(3),
});

export type IdeaReview = z.infer<typeof REVIEW_SCHEMA>;

export type ReviewStatus = "none" | "waiting" | "working" | "done" | "failed" | "paused";

export type IdeaSettings = {
  itemId: string;
  enrolled: boolean;
  noWebSearch: boolean;
  reviewStatus: ReviewStatus;
  reviewRequestedAt: string | null;
  reviewNote: string | null;
  reviewAttempts: number;
  lastError: string | null;
};

export type ReviewFailCode = "refusal" | "schema" | "max_tokens" | "paused";

/** A review that cannot be used; `code` is safe to log and store, it never holds idea text. */
export class ReviewFailed extends Error {
  constructor(readonly code: ReviewFailCode) {
    super(`review failed: ${code}`);
    this.name = "ReviewFailed";
  }
}

/** Spend reached the monthly cap before a paid call; the idea goes back in line, not counted as a failure. */
export class CapReached extends Error {
  constructor() {
    super("ideas monthly cap reached");
    this.name = "CapReached";
  }
}

export const DETECT_SCHEMA = z.object({
  ideas: z
    .array(z.object({ title: z.string(), quote: z.string(), whole_item: z.boolean(), sure: z.boolean() }))
    .max(10),
});

export type DetectedIdea = z.infer<typeof DETECT_SCHEMA>["ideas"][number];

export const SAME_IDEA_SCHEMA = z.object({ match_id: z.string().nullable() });

export type SourceKind = "capture" | "memo";

/** A detection that cannot be used; `code` is safe to log and store, it never holds idea text. */
export class DetectFailed extends Error {
  constructor(readonly code: "refusal" | "schema" | "max_tokens") {
    super(`detection failed: ${code}`);
    this.name = "DetectFailed";
  }
}

/** How one detected idea was filed: a new item, the source itself moved, or a mention on an open idea. */
export const IDEA_OUTCOME = z.object({ kind: z.enum(["new", "moved", "mention"]), id: z.string() });

/** One detected idea as saved on idea_sources.quotes, so a retry files from it instead of detecting again. */
export const SAVED_IDEA = DETECT_SCHEMA.shape.ideas.element.extend({ outcome: IDEA_OUTCOME.nullable() });

export type SavedIdea = z.infer<typeof SAVED_IDEA>;
export type IdeaOutcome = z.infer<typeof IDEA_OUTCOME>;

/** The Ideas Lab's hold on a memo's ideas, for the worker's memo split. */
export type MemoIdeas = { owned: boolean; filed: string[] };
