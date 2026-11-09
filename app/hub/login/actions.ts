"use server";

import { cookies, headers } from "next/headers";
import { safeHubPath } from "@/lib/auth/safe-next";
import { clearedReturnCookie, RETURN_COOKIE, returnCookieOptions } from "@/lib/auth/return-cookie";

/** Remembers where to land after GitHub sign in; anything but a plain hub path clears it instead. */
export async function rememberReturn(next: string): Promise<void> {
  const path = safeHubPath(next);
  const store = await cookies();
  if (path === "/hub") {
    store.set(RETURN_COOKIE, "", clearedReturnCookie);
    return;
  }
  store.set(RETURN_COOKIE, path, returnCookieOptions((await headers()).get("host") ?? ""));
}
