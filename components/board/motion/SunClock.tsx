"use client";

import { useEffect } from "react";
import { sunPhase } from "@/lib/motion/sun";

const TEN_MINUTES = 10 * 60 * 1000;

/** Marks `<html data-sun>` with the time of day where Mason is, so globals.css can tint the page. */
export function SunClock({ offsetMinutes }: { offsetMinutes: number }) {
  useEffect(() => {
    const root = document.documentElement;
    const set = () => {
      root.dataset.sun = sunPhase(offsetMinutes, new Date());
    };
    set();
    const timer = window.setInterval(set, TEN_MINUTES);
    return () => {
      window.clearInterval(timer);
      delete root.dataset.sun;
    };
  }, [offsetMinutes]);
  return null;
}
