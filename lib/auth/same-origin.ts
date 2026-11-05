import type { NextRequest } from "next/server";

/** False when the request names an Origin other than this site; browsers set Origin on cross-site POSTs, so this blocks forged ones. */
export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === request.nextUrl.origin;
}
