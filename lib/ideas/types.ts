import { z } from "zod";

export const PROMPT_VERSION = "review-v1";

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
