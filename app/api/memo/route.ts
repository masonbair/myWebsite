import { handleMemo } from "@/lib/hub/memo";
import { createHubStore } from "@/lib/hub/store";
import { queueMemoIdeas } from "@/lib/ideas/store";
import { serviceClient } from "@/lib/supabase/server";

// Outside proxy.ts's matcher on purpose: phones and the Mac send a bearer token, not a session cookie.
export function POST(request: Request): Promise<Response> {
  return handleMemo(request, {
    token: process.env.MEMO_UPLOAD_TOKEN,
    store: createHubStore(serviceClient(), { kind: "worker", runId: "memo-relay" }),
    memoDetection: process.env.IDEAS_MEMO_DETECTION === "on",
    queueIdeas: (itemId) => queueMemoIdeas(serviceClient(), itemId),
  });
}
