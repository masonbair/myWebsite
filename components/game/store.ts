"use client";

import { useSyncExternalStore } from "react";
import { randomCatColor, randomPlayerName } from "@/lib/cat";

type GameState = {
  score: number;
  playing: boolean;
  leaderboardOpen: boolean;
  /** Picked after mount so server and client HTML match. */
  color: string | null;
  playerName: string;
};

const serverState: GameState = { score: 0, playing: false, leaderboardOpen: false, color: null, playerName: "" };

// Module-level store: the score pill lives in the server-rendered Nav, the cat in the page.
let state = serverState;
// Not render state: only read once, when the real pill replaces the static one.
let placeholderFocused = false;
const listeners = new Set<() => void>();

function set(patch: Partial<GameState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGame() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}

export const game = {
  init: () => state.color ?? set({ color: randomCatColor(), playerName: randomPlayerName() }),
  scorePoint: () => set({ score: state.score + 1 }),
  togglePlay: () => set({ playing: !state.playing }),
  setLeaderboardOpen: (leaderboardOpen: boolean) => set({ leaderboardOpen }),
  isLeaderboardOpen: () => state.leaderboardOpen,
  setPlaceholderFocused: (focused: boolean) => {
    placeholderFocused = focused;
  },
  /** True once, if the static pill had focus when the real one replaced it. */
  takePlaceholderFocus: () => {
    const had = placeholderFocused;
    placeholderFocused = false;
    return had;
  },
  newPlayerName: () => set({ playerName: randomPlayerName() }),
};
