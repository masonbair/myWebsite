import { ArrowRight, TrendDown, TrendUp } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { moveText, toneWord, type Mover, type SubjectSummary, type ToneWord } from "@/lib/news/movers";

// Diverging scale: warm tea for negative, the accent for positive, plain ink tint at the middle.
const TONE_STYLE: Record<ToneWord, string> = {
  "mostly negative": "bg-tea text-night",
  "leaning negative": "bg-tea/35 text-ink",
  mixed: "bg-ink/[0.06] text-ink",
  "leaning positive": "bg-accent/30 text-ink",
  "mostly positive": "bg-accent text-night",
};

export const subjectHref = (s: { kind: string; key: string }) => `/trends/${s.kind}/${s.key}`;

export function TonePill({ tone }: { tone: number }) {
  const word = toneWord(tone);
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_STYLE[word]}`}>{word}</span>;
}

export function MoveBadge({ mover }: { mover: Pick<Mover, "direction" | "base"> }) {
  const Glyph = mover.direction === "rising" ? TrendUp : TrendDown;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-mute">
      <Glyph weight="light" size={16} aria-hidden className={mover.direction === "rising" ? "text-accent-ink" : "text-mute"} />
      <span>
        <span className="font-semibold text-ink">{mover.direction === "rising" ? "Rising" : "Falling"}</span>, {moveText(mover)}
      </span>
    </span>
  );
}

/** One kind's subjects as rows that each link to the subject's page. */
export function TrendList({ subjects, movers }: { subjects: SubjectSummary[]; movers: Map<string, Mover> }) {
  return (
    <ol className="flex flex-col gap-1">
      {subjects.map((s) => {
        const mover = movers.get(`${s.kind}:${s.key}`);
        return (
          <li key={s.key}>
            <Link
              href={subjectHref(s)}
              className="group relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-[calc(1.5rem-0.375rem-0.5rem)] px-4 py-3.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,15rem)_9rem_1.25rem]"
            >
              <span
                aria-hidden
                className="absolute inset-0 rounded-[inherit] bg-ink/[0.04] opacity-0 transition-opacity duration-300 ease-spring group-hover:opacity-100"
              />
              <span className="relative flex min-w-0 items-baseline gap-2">
                <span className="truncate text-lg font-semibold tracking-tight text-ink">{s.label}</span>
                {s.ticker && <span className="font-mono text-xs text-mute">{s.ticker}</span>}
              </span>
              <span className="relative text-right text-sm text-mute md:text-left">
                <span className="font-mono text-base font-medium text-ink">{s.stories}</span> {s.stories === 1 ? "story" : "stories"}
              </span>
              <span className="relative col-span-2 min-w-0 md:col-span-1">
                {mover ? <MoveBadge mover={mover} /> : <span className="text-sm text-mute">Steady</span>}
              </span>
              <span className="relative col-span-2 md:col-span-1">
                <TonePill tone={s.tone} />
              </span>
              <ArrowRight
                weight="light"
                size={18}
                aria-hidden
                className="relative hidden text-mute transition-transform duration-300 ease-spring group-hover:translate-x-0.5 md:block"
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function TrendsFooter() {
  return <p className="mt-12 max-w-[60ch] text-sm text-mute">Counts of what six newsletters I read talked about. Not financial advice.</p>;
}
