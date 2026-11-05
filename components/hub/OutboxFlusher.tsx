"use client";

import { useEffect } from "react";
import { flushOutbox, publishOutbox } from "./outbox-store";

/** Sends waiting captures from any hub page: on load, when the network returns, and when the tab comes back. */
export function OutboxFlusher() {
  useEffect(() => {
    flushOutbox();
    const onVisible = () => document.visibilityState === "visible" && flushOutbox();
    window.addEventListener("online", flushOutbox);
    window.addEventListener("storage", publishOutbox);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flushOutbox);
      window.removeEventListener("storage", publishOutbox);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
