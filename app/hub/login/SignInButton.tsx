"use client";

import { GithubLogo } from "@phosphor-icons/react";
import { useState } from "react";
import { primaryButton } from "@/components/hub/styles";
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
      className={`${primaryButton} mt-6`}
    >
      <GithubLogo weight="bold" size={18} aria-hidden />
      Sign in with GitHub
    </button>
  );
}
