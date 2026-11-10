import { ArrowRight, TrendUp } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { moveText, type Mover } from "@/lib/news/movers";
import { focusRing } from "@/components/ui/sticker";
import { Prompt, Tile } from "../Tile";

/** The three fastest rising newsletter topics; the board lists it only when there are three. */
export function NewsTile({ rising }: { rising: Mover[] }) {
  return (
    <section aria-labelledby="news-tile-title" className="h-full">
      <Tile core="@container flex flex-col gap-5 bg-surface p-6 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Prompt className="text-accent-ink">cat trends.txt</Prompt>
            <h2 id="news-tile-title" className="mt-2 text-xl font-bold tracking-tight text-ink">
              What I&apos;m reading about
            </h2>
          </div>
          <TrendUp weight="light" size={28} className="shrink-0 text-accent-ink" aria-hidden />
        </div>
        <ol className="flex flex-col gap-3 @xl:grid @xl:grid-cols-3 @xl:gap-6">
          {rising.slice(0, 3).map((m) => (
            <li key={m.key} className="min-w-0">
              <p className="truncate text-lg leading-tight font-semibold tracking-tight text-ink">{m.label}</p>
              <p className="mt-0.5 text-sm text-mute">
                <span className="font-mono text-ink">{m.last7}</span> {m.last7 === 1 ? "story" : "stories"} this week, {moveText(m)}
              </p>
            </li>
          ))}
        </ol>
        <Link
          href="/trends"
          className={`group mt-auto inline-flex items-center gap-2 self-start rounded-full text-sm font-semibold text-accent-ink ${focusRing}`}
        >
          See all trends
          <ArrowRight weight="light" size={16} aria-hidden className="transition-transform duration-300 ease-spring group-hover:translate-x-0.5" />
        </Link>
      </Tile>
    </section>
  );
}
