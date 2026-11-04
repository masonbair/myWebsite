import type { CSSProperties, ReactNode } from "react";

/** Fades a tile up on first paint; `index` sets its place in the 60ms stagger. */
export function Reveal({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <div className={`reveal ${className ?? ""}`} style={{ "--i": index } as CSSProperties}>
      {children}
    </div>
  );
}
