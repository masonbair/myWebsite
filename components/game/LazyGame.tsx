"use client";

import { Cat } from "@phosphor-icons/react";
import { useEffect, useSyncExternalStore, type ComponentType } from "react";
import { game, useGame } from "./store";

// Starts the game anyway if the load event is held up, e.g. by a slow third-party request.
const LOAD_FALLBACK_MS = 4000;

type Loaded = { ScorePill: ComponentType; CatGame: ComponentType };

// The game and Motion stay off the first load so their JS doesn't compete with the hero photo.
// Plain import() instead of next/dynamic: the swap happens once, after the code is in, with no loading state in between.
let loaded: Loaded | null = null;
let started = false;
const listeners = new Set<() => void>();

function loadGame() {
  if (started) return;
  started = true;
  Promise.all([import("./ScorePill"), import("./CatGame")])
    .then(([pill, cat]) => {
      loaded = { ScorePill: pill.ScorePill, CatGame: cat.CatGame };
      // Read before the swap: removing a focused node may fire blur, and focus then sits on <body>.
      game.setPlaceholderFocused(document.activeElement?.hasAttribute("data-pill-placeholder") ?? false);
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // A failed chunk (e.g. a flaky network) leaves the placeholder, and its next click tries again.
      started = false;
    });
}

function useLoadedGame() {
  useEffect(() => {
    const idle = () => (window.requestIdleCallback ?? setTimeout)(loadGame);
    const fallback = setTimeout(loadGame, LOAD_FALLBACK_MS);
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      clearTimeout(fallback);
      window.removeEventListener("load", idle);
    };
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => loaded,
    () => null,
  );
}

/** Same look as the live pill at score 0; a click opens the leaderboard as soon as the game arrives. */
function PillPlaceholder() {
  const { leaderboardOpen } = useGame();
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Score 0, leaderboard"
        aria-expanded={leaderboardOpen}
        onClick={() => {
          game.setLeaderboardOpen(true);
          loadGame();
        }}
        data-pill-placeholder
        className="relative flex h-10 items-center gap-1.5 rounded-full border-[2.5px] border-line bg-surface pr-3.5 pl-3 text-sm font-bold text-ink shadow-sticker-sm outline-none before:absolute before:inset-0 before:rounded-full before:bg-ink/5 before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent-ink active:scale-[0.96]"
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
  const loadedGame = useLoadedGame();
  return loadedGame ? <loadedGame.ScorePill /> : <PillPlaceholder />;
}

export function LazyCatGame() {
  const loadedGame = useLoadedGame();
  return loadedGame ? <loadedGame.CatGame /> : null;
}
