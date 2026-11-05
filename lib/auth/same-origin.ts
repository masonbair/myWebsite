import type { NextRequest } from "next/server";

/** False when the request names another site's Origin; `allowNullOrigin` also accepts `Origin: null`, which Android share targets send. */
export function isSameOriginRequest(request: NextRequest, options: { allowNullOrigin?: boolean } = {}): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === request.nextUrl.origin) return true;
  return options.allowNullOrigin === true && origin === "null";
}
