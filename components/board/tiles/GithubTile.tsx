import { ArrowUpRight, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import type { GithubActivity } from "@/lib/github";
import { tag } from "@/components/ui/sticker";
import { Prompt, Tile } from "../Tile";

const PROFILE = "https://github.com/masonbair";
const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
const plural = (n: number, word: string) => `${word}${n === 1 ? "" : "s"}`;
const countFormat = new Intl.NumberFormat("en-US");

// JetBrains Mono gives the comma a full digit slot, so separators use the sans font to keep "1,331" tight.
function Count({ n }: { n: number }) {
  return countFormat.formatToParts(n).map((p, i) =>
    p.type === "group" ? (
      <span key={i} className="-ml-[0.04em] font-sans tracking-[-0.12em]">
        {p.value}
      </span>
    ) : (
      p.value
    ),
  );
}

export function GithubTile({ github }: { github: GithubActivity | null }) {
  if (!github) {
    return (
      <Tile core="flex flex-col justify-between gap-8 bg-surface p-6">
        <div>
          <Prompt className="text-mute">git log --me</Prompt>
          <GithubLogo weight="light" size={28} className="mt-2 text-ink" aria-hidden />
        </div>
        <a
          href={PROFILE}
          target="_blank"
          rel="noopener noreferrer"
          className={`group inline-flex w-fit items-center gap-3 rounded-full border-2 border-line bg-surface py-1.5 pr-1.5 pl-5 text-base font-semibold text-ink transition-transform duration-300 ease-spring active:scale-[0.98] ${focusRing}`}
        >
          See what I&apos;m building
          <span className="flex size-8 items-center justify-center rounded-full bg-accent text-night transition-transform duration-300 ease-spring group-hover:translate-x-0.5 group-hover:-translate-y-px">
            <ArrowUpRight weight="light" size={16} aria-hidden />
          </span>
        </a>
      </Tile>
    );
  }

  const { total30d, commits30d, repos30d, recent } = github;
  return (
    <Tile core="flex flex-col justify-between gap-5 bg-surface p-6">
      <div>
        <Prompt className="text-mute">git log --me</Prompt>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={`${tag} text-[11px] border-line bg-surface text-ink`}>GitHub</span>
          <a href={PROFILE} target="_blank" rel="noopener noreferrer" aria-label="masonbair on GitHub" className={`rounded-full font-bold text-ink ${focusRing}`}>
            masonbair
          </a>
        </div>
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-6xl leading-none font-medium tracking-tighter text-accent-ink lg:text-5xl xl:text-6xl">
            <Count n={total30d} />
          </span>
          <span className="text-xl font-semibold text-ink">{plural(total30d, "contribution")}</span>
        </p>
        <p className="mt-1 text-sm text-mute">last 30 days</p>
        {commits30d > 0 && (
          <p className="mt-1 text-sm text-mute">
            <span className="font-mono">{commits30d}</span> public {plural(commits30d, "commit")} across{" "}
            <span className="font-mono">{repos30d}</span> {plural(repos30d, "repo")}
          </p>
        )}
      </div>
      {recent.length > 0 && (
        <ul className="flex flex-col gap-1">
          {recent.map((r) => (
            <li key={r.name}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`group flex items-center justify-between gap-2 rounded-full text-sm font-medium text-ink ${focusRing}`}
              >
                <span className="truncate">{r.name}</span>
                <ArrowUpRight
                  weight="light"
                  size={14}
                  className="shrink-0 text-mute transition-transform duration-300 ease-spring group-hover:translate-x-0.5 group-hover:-translate-y-px"
                  aria-hidden
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}
