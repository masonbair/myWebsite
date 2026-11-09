"use client";

import { GithubLogo } from "@phosphor-icons/react";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

function callbackUrl(origin: string, next: string): string {
  const url = new URL("/hub/auth/callback", origin);
  if (next !== "/hub") url.searchParams.set("next", next);
  return url.toString();
}

/** @param next hub path the callback returns to; the callback checks it again. */
export function SignInButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    // This page's own origin, so preview deploys come back to themselves.
    const { error } = await browserClient().auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: callbackUrl(window.location.origin, next) },
    });
    if (error) setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={busy}
      className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-night transition-opacity duration-300 ease-spring hover:opacity-90 disabled:opacity-60 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <GithubLogo weight="bold" size={18} aria-hidden />
      Sign in with GitHub
    </button>
  );
}
