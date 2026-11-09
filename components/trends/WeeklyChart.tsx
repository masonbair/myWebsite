import { shortDate, toneWord, type Week } from "@/lib/news/movers";

// The charts stretch to their box, so bars keep a fixed height on phones instead of shrinking with the width.
const SLOT = 10;
const BAR = 8;
const R = 2;

// Rounded at the data end, square on the baseline; `up` false draws a bar hanging below it.
function barPath(x: number, base: number, end: number) {
  const up = end < base;
  const r = Math.min(R, Math.abs(base - end));
  const tip = up ? end + r : end - r;
  return `M${x},${base} V${tip} Q${x},${end} ${x + r},${end} H${x + BAR - r} Q${x + BAR},${end} ${x + BAR},${tip} V${base} Z`;
}

function niceMax(n: number) {
  if (n <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (step / 2)) * (step / 2);
}

function monthTicks(weeks: Week[]) {
  const ticks: { i: number; label: string }[] = [];
  weeks.forEach((w, i) => {
    const prev = weeks[i - 1];
    if (prev && w.end.slice(5, 7) !== prev.end.slice(5, 7) && Number(w.end.slice(5, 7)) % 3 === 1) {
      ticks.push({ i, label: new Date(`${w.end}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
    }
  });
  return ticks;
}

function Axis({ weeks }: { weeks: Week[] }) {
  return (
    <div aria-hidden className="relative mt-2 h-4 text-xs text-mute">
      {monthTicks(weeks).map(({ i, label }) => (
        <span key={i} className="absolute -translate-x-1/2" style={{ left: `${((i * SLOT + BAR / 2) / (weeks.length * SLOT)) * 100}%` }}>
          {label}
        </span>
      ))}
    </div>
  );
}

function Table({ weeks, caption }: { weeks: Week[]; caption: string }) {
  return (
    <details className="mt-5 text-sm text-mute">
      <summary className="cursor-pointer rounded-full font-medium text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        Show as a table
      </summary>
      <div className="mt-3 max-h-72 overflow-y-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 font-medium">Week ending</th>
              <th scope="col" className="py-1 font-medium">Stories</th>
              <th scope="col" className="py-1 font-medium">Tone</th>
            </tr>
          </thead>
          <tbody className="font-mono text-ink">
            {[...weeks].reverse().map((w) => (
              <tr key={w.end}>
                <td className="py-0.5 font-sans">{shortDate(w.end)}</td>
                <td className="py-0.5">{w.stories}</td>
                <td className="py-0.5 font-sans">{w.tone === null ? "none" : toneWord(w.tone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Columns of stories per week over 52 weeks, one hue, with a native tooltip per week. */
export function CountChart({ weeks }: { weeks: Week[] }) {
  const W = weeks.length * SLOT;
  const H = 140;
  const max = niceMax(Math.max(0, ...weeks.map((w) => w.stories)));
  const peak = weeks.reduce((a, b) => (b.stories > a.stories ? b : a), weeks[0]);
  const y = (n: number) => H - (n / max) * (H - 4);
  const label = `Stories per week over the last 12 months. Most in one week: ${peak.stories}, week ending ${shortDate(peak.end)}.`;
  return (
    <figure>
      <div className="relative pl-8">
        <span className="absolute top-0 left-0 font-mono text-xs leading-none text-mute">{max}</span>
        <span className="absolute bottom-0 left-0 font-mono text-xs leading-none text-mute">0</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-40 w-full overflow-visible md:h-48">
          <line x1={0} x2={W} y1={0.5} y2={0.5} className="stroke-ink/10" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-ink/10" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-ink/20" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {weeks.map((w, i) => (
            <g key={w.end} className="group">
              <title>{`Week ending ${shortDate(w.end)}: ${w.stories} ${w.stories === 1 ? "story" : "stories"}`}</title>
              <rect x={i * SLOT} y={0} width={SLOT} height={H} className="fill-transparent group-hover:fill-ink/[0.05]" />
              {w.stories > 0 && <path d={barPath(i * SLOT + 1, H, y(w.stories))} className="fill-accent" />}
            </g>
          ))}
        </svg>
      </div>
      <div className="pl-8">
        <Axis weeks={weeks} />
      </div>
      <Table weeks={weeks} caption="Stories and tone per week" />
    </figure>
  );
}

/** Mention-weighted tone per week as columns above (positive) or below (negative) a zero line. */
export function ToneChart({ weeks }: { weeks: Week[] }) {
  const W = weeks.length * SLOT;
  const H = 120;
  const mid = H / 2;
  const y = (t: number) => mid - t * (mid - 2);
  const toned = weeks.filter((w) => w.tone !== null);
  const avg = toned.length ? toned.reduce((s, w) => s + (w.tone ?? 0), 0) / toned.length : 0;
  const label = `Tone per week over the last 12 months, from negative to positive. Overall ${toneWord(avg)}.`;
  return (
    <figure>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-mute">
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-sm bg-accent" />
          Positive
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-sm bg-tea" />
          Negative
        </li>
      </ul>
      <div className="relative pl-8">
        <span className="absolute top-0 left-0 text-xs leading-none text-mute">+</span>
        <span className="absolute top-1/2 left-0 -translate-y-1/2 font-mono text-xs leading-none text-mute">0</span>
        <span className="absolute bottom-0 left-0 text-xs leading-none text-mute">-</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-32 w-full overflow-visible md:h-40">
          <line x1={0} x2={W} y1={mid} y2={mid} className="stroke-ink/25" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {weeks.map((w, i) => (
            <g key={w.end} className="group">
              <title>{`Week ending ${shortDate(w.end)}: ${w.tone === null ? "no stories" : toneWord(w.tone)}`}</title>
              <rect x={i * SLOT} y={0} width={SLOT} height={H} className="fill-transparent group-hover:fill-ink/[0.05]" />
              {w.tone !== null && Math.abs(w.tone) >= 0.01 && (
                <path d={barPath(i * SLOT + 1, mid, y(w.tone))} className={w.tone > 0 ? "fill-accent" : "fill-tea"} />
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="pl-8">
        <Axis weeks={weeks} />
      </div>
    </figure>
  );
}
