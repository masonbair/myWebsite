import { after } from "next/server";
import { anthropicClient } from "@/lib/ai/claude";
import { masonTimeZone } from "@/lib/hub/events";
import { handleTranscript } from "@/lib/learn/api";
import { gradeAndGrant } from "@/lib/learn/award";
import { learnCapUsd } from "@/lib/learn/budget";
import { signingKey } from "@/lib/learn/grant";
import { supabaseLearnStore } from "@/lib/learn/store";
import { serviceClient } from "@/lib/supabase/server";

// Grading runs in after() and can take about a minute; the 15-minute learn event retries anything that does not finish.
export const maxDuration = 120;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = serviceClient();
  const store = supabaseLearnStore(client);
  return handleTranscript(request, id, {
    token: process.env.LEARN_HINOTE_TOKEN,
    store,
    schedule: (answerId) =>
      after(async () => {
        try {
          await gradeAndGrant(
            {
              store,
              anthropic: anthropicClient("learn"),
              key: signingKey(process.env.LEARN_GRANT_PRIVATE_KEY),
              now: () => new Date(),
              timeZone: await masonTimeZone(client),
              cap: learnCapUsd(process.env),
            },
            answerId,
          );
        } catch (e) {
          console.error(`learn: voice answer ${answerId} not graded: ${(e as Error).name}`);
        }
      }),
  });
}
