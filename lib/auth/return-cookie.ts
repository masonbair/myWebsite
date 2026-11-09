/** Holds the hub path to return to across the GitHub round trip, so the OAuth redirect URL stays exactly as allow-listed. */
export const RETURN_COOKIE = "hub_return";
export const RETURN_COOKIE_PATH = "/hub/auth/callback";
const TEN_MINUTES = 600;

export function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/** @param host the request's Host header; Secure is left off only for local dev over plain http. */
export function returnCookieOptions(host: string) {
  return { httpOnly: true, secure: !isLocalHost(host), sameSite: "lax" as const, path: RETURN_COOKIE_PATH, maxAge: TEN_MINUTES };
}

export const clearedReturnCookie = { path: RETURN_COOKIE_PATH, maxAge: 0 };
