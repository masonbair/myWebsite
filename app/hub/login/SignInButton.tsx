"use client";

import { GithubLogo } from "@phosphor-icons/react";
import { useState } from "react";
import { primaryButton } from "@/components/hub/styles";
import { browserClient } from "@/lib/supabase/browser";

export function SignInButton() {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
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
