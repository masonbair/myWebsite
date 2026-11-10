import type { NextRequest } from "next/server";

/** False when the request names another site's Origin; `allowNullOrigin` also accepts `Origin: null`, which Android share targets send. */
export function isSameOriginRequest(request: NextRequest, options: { allowNullOrigin?: boolean } = {}): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === request.nextUrl.origin) return true;
  return options.allowNullOrigin === true && origin === "null";
}

/** For server actions: true when there is no Origin header or it names the host that served the request. */
export function isSameOriginHeaders(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (origin === null) return true;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
