"use client";

import { useEffect } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useLean } from "./useLean";

/** The board's live effects; loaded only after first paint by LazyBoardMotion. */
export function BoardMotion({ sunOffsetMinutes }: { sunOffsetMinutes: number | null }) {
  const reduce = useReducedMotion();
  useLean(reduce);

  useEffect(() => {
    document.documentElement.dataset.boardMotion = "ready";
    return () => {
      delete document.documentElement.dataset.boardMotion;
    };
  }, []);

  void sunOffsetMinutes;
  return null;
}
