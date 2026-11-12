import { after } from "next/server";
import { handleTranscript } from "@/lib/learn/api";
import { gradeAndGrant } from "@/lib/learn/award";
import { learnRuntime } from "@/lib/learn/runtime";

// Grading runs in after() and can take about a minute; the 15-minute learn event retries anything that does not finish.
export const maxDuration = 120;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { store, awardDeps } = await learnRuntime();
  return handleTranscript(request, id, {
    token: process.env.LEARN_HINOTE_TOKEN,
    store,
    schedule: (answerId) =>
      after(async () => {
        try {
          await gradeAndGrant(awardDeps, answerId);
        } catch (e) {
          console.error(`learn: voice answer ${answerId} not graded: ${(e as Error).name}`);
        }
      }),
  });
}
