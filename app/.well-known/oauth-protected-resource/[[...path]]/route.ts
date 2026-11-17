import type { NextRequest } from "next/server";
import { protectedResourceMetadata } from "@/lib/hub/oauth";

// Clients look this up both at the root and with the MCP path appended, so one catch-all route answers both.
export function GET(request: NextRequest) {
  return Response.json(protectedResourceMetadata(request.nextUrl.origin));
}
