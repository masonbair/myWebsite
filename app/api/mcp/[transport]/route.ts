import type { NextRequest } from "next/server";
import { mcpRequestGuard, withCappedBody } from "@/lib/hub/mcp-guard";
import { handleMcpRequest } from "@/lib/hub/mcp-tools";
import { accessTokenValid, challengeHeader } from "@/lib/hub/oauth";
import { supabaseGrantStore } from "@/lib/hub/oauth-store";
import { readPrivatePlace } from "@/lib/hub/place";
import { createHubStore } from "@/lib/hub/store";
import { createNewsReader } from "@/lib/news/reader";
import { timelineWriter } from "@/lib/hub/timeline";
import { loadNow } from "@/lib/now";
import { serviceClient } from "@/lib/supabase/server";

// Not behind proxy.ts (it only gates /hub and /api/hub), so handleMcpRequest checks the token or OAuth sign-in itself.
async function handle(request: NextRequest, ctx: { params: Promise<{ transport: string }> }) {
  const refused = mcpRequestGuard(request);
  if (refused) return refused;
  const { transport } = await ctx.params;
  if (transport !== "mcp") return Response.json({ error: "not found" }, { status: 404 });
  const capped = await withCappedBody(request);
  if (capped instanceof Response) return capped;
  return handleMcpRequest(capped, {
    token: process.env.HUB_AGENT_TOKEN,
    storeFor: (client) => createHubStore(serviceClient(), { kind: "agent", client }),
    readNow: () => loadNow(),
    readPlace: () => readPrivatePlace(serviceClient()),
    news: createNewsReader(serviceClient()),
    ideasClient: serviceClient(),
    now: () => new Date(),
    timelineFor: (client) => timelineWriter(serviceClient(), { kind: "agent", client }),
    oauth: {
      accessTokenValid: (token) => accessTokenValid(supabaseGrantStore(serviceClient()), token, request.nextUrl.origin, new Date()),
      challenge: challengeHeader(request.nextUrl.origin),
    },
  });
}

export { handle as DELETE, handle as GET, handle as POST };
