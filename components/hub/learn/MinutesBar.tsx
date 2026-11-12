import { DAILY_CAP_MINUTES } from "@/lib/learn/types";

/** Today's earned Instagram bonus against the daily cap. */
export function MinutesBar({ earned }: { earned: number }) {
  const percent = Math.min(100, Math.round((earned / DAILY_CAP_MINUTES) * 100));
  return (
    <div className="rounded-full border-2 border-line bg-surface px-4 py-2">
      <div className="flex items-center gap-3 text-sm font-semibold">
        <span>Instagram bonus</span>
        <div aria-hidden className="h-2.5 flex-1 overflow-hidden rounded-full border-[1.5px] border-line bg-canvas">
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        <span className="font-mono tabular-nums" data-testid="learn-earned">
          +{earned} / {DAILY_CAP_MINUTES} min
        </span>
      </div>
      <p className="mt-0.5 text-xs text-mute">Counts 10:00 to 20:00.</p>
    </div>
  );
}
