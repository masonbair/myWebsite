"use client";

import { useState } from "react";

type Point = { day: string; value: number };

const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function label(day: string): string {
  return dayLabel.format(new Date(`${day}T00:00:00Z`));
}

/** Single-series daily bar chart with a hover/focus tooltip and a table fallback. */
export function DailyBars({ title, unit, points }: { title: string; unit: string; points: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const height = 120;
  const slot = 100 / points.length;
  const shown = active === null ? null : points[active];

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex items-baseline justify-between gap-4">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-mute tabular-nums" aria-live="polite">
          {shown ? `${label(shown.day)}: ${shown.value.toLocaleString()} ${unit}` : `peak ${max.toLocaleString()} ${unit}`}
        </span>
      </figcaption>
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block h-32 w-full" aria-hidden>
          <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} className="stroke-ink/15" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => {
            const h = p.value === 0 ? 0 : Math.max(2, (p.value / max) * (height - 4));
            return (
              <rect
                key={p.day}
                x={i * slot + slot * 0.15}
                width={slot * 0.7}
                y={height - h}
                height={h}
                rx="0.6"
                className={active === i ? "fill-accent-ink" : "fill-accent"}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex">
          {points.map((p, i) => (
            <button
              key={p.day}
              type="button"
              className="h-full flex-1 cursor-default outline-none focus-visible:bg-ink/5"
              aria-label={`${label(p.day)}: ${p.value} ${unit}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-xs text-mute tabular-nums">
        <span>{points[0] && label(points[0].day)}</span>
        <span>{points.at(-1) && label(points.at(-1)!.day)}</span>
      </div>
    </figure>
  );
}
