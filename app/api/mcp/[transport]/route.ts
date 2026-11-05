import type { NextRequest } from "next/server";
import { mcpRequestGuard } from "@/lib/hub/mcp-guard";
import { handleMcpRequest } from "@/lib/hub/mcp-tools";
import { createHubStore } from "@/lib/hub/store";
import { loadNow } from "@/lib/now";
import { serviceClient } from "@/lib/supabase/server";

// Not behind proxy.ts (it only gates /hub and /api/hub), so handleMcpRequest checks HUB_AGENT_TOKEN itself.
async function handle(request: NextRequest, ctx: { params: Promise<{ transport: string }> }) {
  const refused = mcpRequestGuard(request);
  if (refused) return refused;
  const { transport } = await ctx.params;
  if (transport !== "mcp") return Response.json({ error: "not found" }, { status: 404 });
  return handleMcpRequest(request, {
    token: process.env.HUB_AGENT_TOKEN,
    storeFor: (client) => createHubStore(serviceClient(), { kind: "agent", client }),
    readNow: () => loadNow(),
  });
}

export { handle as DELETE, handle as GET, handle as POST };
