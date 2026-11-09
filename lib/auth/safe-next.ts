// Letters, digits, slash, dash and underscore only: no dot, colon, backslash, query or percent, so nothing can leave the hub.
const HUB_PATH = /^\/hub\/[A-Za-z0-9/_-]*$/;

/** The hub path to return to after sign in, or /hub when `value` is anything but a plain same-site hub path. */
export function safeHubPath(value: unknown): string {
  if (typeof value !== "string" || !HUB_PATH.test(value) || value.includes("//")) return "/hub";
  return value;
}

/** The login page URL that returns to `path` after sign in. */
export function loginHref(path: string | null | undefined): string {
  const next = safeHubPath(path);
  return next === "/hub" ? "/hub/login" : `/hub/login?next=${encodeURIComponent(next)}`;
}
