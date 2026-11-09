import { describe, expect, it, vi } from "vitest";
import { planOlderReviews, queueOlderReviews, supabaseDeps, type OlderDeps } from "@/scripts/ideas-review-older";
import { fakePostgrest } from "./fake-postgrest";

function fakeDeps(over: Partial<OlderDeps> = {}): OlderDeps & { queued: string[][] } {
  const queued: string[][] = [];
  return {
    queued,
    openIdeaIds: async () => ["a", "b", "c", "d"],
    enrolledIds: async () => new Set(["b"]),
    averageReviewCost: async () => 0.25,
    queue: async (ids) => {
      queued.push(ids);
    },
    ...over,
  };
}

describe("ideas-review-older", () => {
  it("counts open ideas that are not enrolled and prices them from the measured cost", async () => {
    expect(await planOlderReviews(fakeDeps())).toEqual({ ids: ["a", "c", "d"], perReview: 0.25, estimate: 0.75 });
  });

  it("has no estimate before any review was measured", async () => {
    expect(await planOlderReviews(fakeDeps({ averageReviewCost: async () => null }))).toMatchObject({ estimate: null });
  });

  it("queues nothing unless the answer is exactly yes", async () => {
    for (const answer of ["", "y", "Yes please", "no", "YES!"]) {
      const deps = fakeDeps();
      expect(await queueOlderReviews(deps, answer)).toBe(0);
      expect(deps.queued).toEqual([]);
    }
  });

  it("queues every counted idea on yes", async () => {
    const deps = fakeDeps();
    const queue = vi.spyOn(deps, "queue");
    expect(await queueOlderReviews(deps, " yes\n")).toBe(3);
    expect(queue).toHaveBeenCalledWith(["a", "c", "d"]);
  });

  it("reads every open idea past the server's 1000-row page", async () => {
    const items = Array.from({ length: 2500 }, (_, n) => ({ id: `id-${String(n).padStart(5, "0")}`, list: n % 10 === 0 ? "todo" : "ideas", state: "open" }));
    const fake = fakePostgrest({ items }, { maxRows: 1000 });
    expect(await supabaseDeps(fake.client).openIdeaIds()).toHaveLength(2250);
  });
});
