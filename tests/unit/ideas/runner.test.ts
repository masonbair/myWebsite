import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/claude", () => ({ anthropicClient: () => null, monthSpend: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));
const runIdeasJob = vi.fn(async (deps: { resurface?: () => Promise<number> }) => ({ resurfaced: await deps.resurface!() }));
vi.mock("@/lib/ideas/job", () => ({ runIdeasJob: (d: never) => runIdeasJob(d), budgetFromEnv: () => 20 }));
const runResurface = vi.fn(async () => 1);
vi.mock("@/lib/ideas/resurface-step", () => ({ runResurface: () => runResurface() }));
vi.mock("@/lib/ideas/resurface-store", () => ({ createResurfaceStore: () => ({}) }));
vi.mock("@/lib/ideas/store", () => ({ createIdeasJobStore: () => ({}) }));

import { ideasRunner } from "@/lib/ideas/runner";

describe("ideasRunner", () => {
  it("is built without a Claude key and still resurfaces", async () => {
    const run = ideasRunner();
    expect(typeof run).toBe("function");
    expect(await run()).toEqual({ resurfaced: 1 });
    expect(runIdeasJob.mock.calls[0][0]).toMatchObject({ anthropic: null });
    expect(runResurface).toHaveBeenCalledTimes(1);
  });
});
