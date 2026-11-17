import type { NextRequest } from "next/server";
import { authServerMetadata } from "@/lib/hub/oauth";

export function GET(request: NextRequest) {
  return Response.json(authServerMetadata(request.nextUrl.origin));
}
