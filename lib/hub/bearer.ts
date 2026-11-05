import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time check of an `Authorization: Bearer <token>` header against the expected token. */
export function tokenMatches(header: string | null, expected: string): boolean {
  const given = header?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected)) && given.length > 0;
}
