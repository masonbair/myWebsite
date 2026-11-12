"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { DotField } from "./DotField";
import { useLean } from "./useLean";

const FINE = "(pointer: fine)";

function useFinePointer() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(FINE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(FINE).matches,
    () => false,
  );
}

/** The board's live effects; loaded only after first paint by LazyBoardMotion. */
export function BoardMotion({ sunOffsetMinutes }: { sunOffsetMinutes: number | null }) {
  const reduce = useReducedMotion();
  const fine = useFinePointer();
  useLean(reduce);

  useEffect(() => {
    document.documentElement.dataset.boardMotion = "ready";
    return () => {
      delete document.documentElement.dataset.boardMotion;
    };
  }, []);

  void sunOffsetMinutes;
  return <>{fine && !reduce && <DotField />}</>;
}
