"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { Doodle } from "./Doodle";
import { DotField } from "./DotField";
import { SunClock } from "./SunClock";
import { useLean } from "./useLean";
import { useStickerBurst } from "./useStickerBurst";

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
/** `scope`: selector of the container whose tiles lean; `doodle` is off where there's no board to draw on. */
export function BoardMotion({
  sunOffsetMinutes,
  scope = "[data-board-grid]",
  doodle = true,
}: {
  sunOffsetMinutes: number | null;
  scope?: string;
  doodle?: boolean;
}) {
  const reduce = useReducedMotion();
  const fine = useFinePointer();
  useLean(reduce, scope);
  useStickerBurst(reduce);

  useEffect(() => {
    document.documentElement.dataset.boardMotion = "ready";
    return () => {
      delete document.documentElement.dataset.boardMotion;
    };
  }, []);

  return (
    <>
      {fine && !reduce && <DotField />}
      {doodle && <Doodle />}
      {sunOffsetMinutes !== null && <SunClock offsetMinutes={sunOffsetMinutes} />}
    </>
  );
}
