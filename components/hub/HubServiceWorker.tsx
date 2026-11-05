"use client";

import { useEffect } from "react";

// Off in dev so a cached page never hides a code change; e2e opts in with NEXT_PUBLIC_HUB_SW=1.
const ENABLED = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_HUB_SW === "1";

/** Registers public/hub/sw.js for the hub only, which lets the hub install and opens capture offline. */
export function HubServiceWorker() {
  useEffect(() => {
    if (!ENABLED || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/hub/sw.js", { scope: "/hub/" }).catch((e: unknown) => {
      console.error("hub service worker did not register", e);
    });
  }, []);
  return null;
}
