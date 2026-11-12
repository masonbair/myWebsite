"use client";

import { useEffect, useState, type ComponentType } from "react";

// Starts anyway if the load event is held up, e.g. by a slow third-party request.
const LOAD_FALLBACK_MS = 4000;

type Props = { sunOffsetMinutes: number | null };

// Plain import() after load and idle time keeps the board's effects off the first load, like components/game/LazyGame.tsx.
export function LazyBoardMotion(props: Props) {
  const [Motion, setMotion] = useState<ComponentType<Props> | null>(null);

  useEffect(() => {
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      import("./BoardMotion")
        .then((m) => setMotion(() => m.BoardMotion))
        .catch(() => {
          // A failed chunk leaves the still board, which is fine.
        });
    };
    const idle = () => (window.requestIdleCallback ?? setTimeout)(load);
    const fallback = setTimeout(load, LOAD_FALLBACK_MS);
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      clearTimeout(fallback);
      window.removeEventListener("load", idle);
    };
  }, []);

  return Motion ? <Motion {...props} /> : null;
}
