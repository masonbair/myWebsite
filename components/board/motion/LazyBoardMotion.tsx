"use client";

import { useIdleImport } from "@/lib/use-idle-import";

type Props = { sunOffsetMinutes: number | null; scope?: string; doodle?: boolean };

const importMotion = () => import("./BoardMotion");

// Plain import() after load and idle time keeps the board's effects off the first load, like components/game/LazyGame.tsx.
export function LazyBoardMotion(props: Props) {
  const mod = useIdleImport(importMotion);
  return mod ? <mod.BoardMotion {...props} /> : null;
}
