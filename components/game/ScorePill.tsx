"use client";

import { Cat } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Leaderboard } from "./Leaderboard";
import { game, useGame } from "./store";

/** Nav pill with the live game score; opens the leaderboard. */
export function ScorePill() {
  const { score, leaderboardOpen } = useGame();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    game.setLeaderboardOpen(false);
    pillRef.current?.focus();
  };

  // The open leaderboard focuses its own close button, so only carry focus over when it is shut.
  useEffect(() => {
    if (game.takePlaceholderFocus() && !game.isLeaderboardOpen()) pillRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!leaderboardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      game.setLeaderboardOpen(false);
      pillRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && game.setLeaderboardOpen(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [leaderboardOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={pillRef}
        type="button"
        aria-label={`Score ${score}, leaderboard`}
        aria-expanded={leaderboardOpen}
        aria-controls="leaderboard"
        onClick={() => game.setLeaderboardOpen(!leaderboardOpen)}
        className="relative flex h-10 items-center gap-1.5 rounded-full bg-accent/15 pr-3.5 pl-3 text-sm font-semibold text-accent-ink outline-none before:absolute before:inset-0 before:rounded-full before:bg-accent/15 before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.96]"
      >
        <Cat weight="light" size={18} aria-hidden className="relative" />
        <motion.span
          key={score}
          data-testid="score"
          initial={reduce || score === 0 ? false : { scale: 1.4, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 18 }}
          className="relative inline-block min-w-[1ch] text-center font-mono tabular-nums"
        >
          {score}
        </motion.span>
      </button>
      <AnimatePresence>{leaderboardOpen && <Leaderboard onClose={close} />}</AnimatePresence>
    </div>
  );
}
