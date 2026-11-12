import type { CSSProperties, ReactNode } from "react";

/** Brings a tile in (fade-up, or swing-in on scroll); `index` sets its place in the 60ms stagger, `tile` names it for the board's effects. */
export function Reveal({
  index,
  tile,
  className,
  children,
}: {
  index: number;
  tile?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-tile={tile} className={`reveal ${className ?? ""}`} style={{ "--i": index } as CSSProperties}>
      {children}
    </div>
  );
}
