import type { NextRequest } from "next/server";
import { createHubStore } from "@/lib/hub/store";
import { handleWorkerRequest } from "@/lib/hub/worker-api";
import { ideasFiledFrom } from "@/lib/ideas/store";
import { serviceClient } from "@/lib/supabase/server";

// The service role cannot complete or reopen an item (the database refuses), and no route here asks it to.
async function handle(request: NextRequest, ctx: { params: Promise<{ op: string[] }> }) {
  const { op } = await ctx.params;
  return handleWorkerRequest(request, op, {
    token: process.env.HUB_WORKER_TOKEN,
    storeFor: (runId) => createHubStore(serviceClient(), { kind: "worker", runId }),
    now: () => new Date(),
    ideasFiled: (memoIds) => ideasFiledFrom(serviceClient(), memoIds),
  });
}

export { handle as GET, handle as PATCH, handle as POST, handle as PUT };
