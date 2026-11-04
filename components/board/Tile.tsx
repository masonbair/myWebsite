import type { ReactNode } from "react";

/** Double-bezel tile: a faint 5% ink tray around a core with its own background. */
export function Tile({ core, children }: { core: string; children: ReactNode }) {
  return (
    <div className="h-full rounded-tile bg-ink/[0.03] p-1.5 shadow-tile ring-1 ring-ink/5">
      <div
        className={`relative h-full overflow-hidden rounded-[calc(1.5rem-0.375rem)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] ${core}`}
      >
        {children}
      </div>
    </div>
  );
}
