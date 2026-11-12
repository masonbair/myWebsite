import type { ReactNode } from "react";

// The board's effects set these variables on the tile's wrapper; the tilt uses the separate `rotate` property, so both apply.
const lean =
  "[transform:perspective(1600px)_rotateX(var(--lean-y,0deg))_rotateY(var(--lean-x,0deg))_translateY(var(--lift,0px))] transition-[transform,box-shadow] duration-300 ease-spring motion-reduce:transition-none";

const tilts = { none: "", left: "md:-rotate-[1.5deg]", right: "md:rotate-[2deg]" };

/** Sticker tile: thick ink outline with a hard offset shadow; `tilt` cocks it a little on wider screens. */
export function Tile({
  core,
  tilt = "none",
  children,
}: {
  core: string;
  tilt?: keyof typeof tilts;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative h-full overflow-hidden rounded-tile border-[2.5px] border-line shadow-tile ${lean} ${tilts[tilt]} ${core}`}
    >
      {children}
    </div>
  );
}

/** Tiny command-line prompt above a tile label, e.g. `$ whereami`. Decorative, so screen readers skip it. */
export function Prompt({ children, className = "" }: { children: string; className?: string }) {
  return (
    <p aria-hidden className={`font-mono text-[11px] leading-none font-medium ${className}`}>
      $ {children}
    </p>
  );
}
