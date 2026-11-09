"use client";

import { GithubLogo } from "@phosphor-icons/react";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { rememberReturn } from "./actions";

/** @param next hub path to land on after sign in; the server checks it when storing and again in the callback. */
export function SignInButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    try {
      await rememberReturn(next);
    } catch {
      // Sign in still works without the return path; it just lands on /hub.
    }
    // This page's own origin, so preview deploys come back to themselves.
    const { error } = await browserClient().auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/hub/auth/callback` },
    });
    if (error) setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={busy}
      className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-night transition-opacity duration-300 ease-spring hover:opacity-90 disabled:opacity-60 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
    >
      <GithubLogo weight="bold" size={18} aria-hidden />
      Sign in with GitHub
    </button>
  );
}
