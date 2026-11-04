"use client";

import { Cat } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";
import { game } from "./store";

// The game and Motion stay off the first load so their JS doesn't compete with the hero photo.
const ScorePill = dynamic(() => import("./ScorePill").then((m) => m.ScorePill), {
  ssr: false,
  loading: () => <PillPlaceholder />,
});
const CatGame = dynamic(() => import("./CatGame").then((m) => m.CatGame), { ssr: false });

let ready = false;
let placeholderFocused = false;
const listeners = new Set<() => void>();

function loadGame() {
  if (ready) return;
  ready = true;
  listeners.forEach((l) => l());
}

function useGameReady() {
  useEffect(() => {
    const idle = () => (window.requestIdleCallback ?? setTimeout)(loadGame);
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => window.removeEventListener("load", idle);
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ready,
    () => false,
  );
}

/** True once, if the static pill had focus when the real one replaced it. */
export function takePlaceholderFocus() {
  const had = placeholderFocused;
  placeholderFocused = false;
  return had;
}

/** Same look as the live pill at score 0; a click, even while the chunk loads, opens the leaderboard once it arrives. */
function PillPlaceholder() {
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Score 0, leaderboard"
        aria-expanded={false}
        onClick={() => {
          game.setLeaderboardOpen(true);
          loadGame();
        }}
        onFocus={() => (placeholderFocused = true)}
        onBlur={() => (placeholderFocused = false)}
        className="relative flex h-10 items-center gap-1.5 rounded-full bg-accent/15 pr-3.5 pl-3 text-sm font-semibold text-accent-ink outline-none before:absolute before:inset-0 before:rounded-full before:bg-accent/15 before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.96]"
      >
        <Cat weight="light" size={18} aria-hidden className="relative" />
        <span data-testid="score" className="relative inline-block min-w-[1ch] text-center font-mono tabular-nums">
          0
        </span>
      </button>
    </div>
  );
}

export function LazyScorePill() {
  const isReady = useGameReady();
  return isReady ? <ScorePill /> : <PillPlaceholder />;
}

export function LazyCatGame() {
  return useGameReady() ? <CatGame /> : null;
}
