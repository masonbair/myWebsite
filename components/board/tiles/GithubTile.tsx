import { ArrowUpRight, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import type { GithubActivity } from "@/lib/github";
import { Tile } from "../Tile";

const PROFILE = "https://github.com/masonbair";
const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const plural = (n: number, word: string) => `${word}${n === 1 ? "" : "s"}`;

export function GithubTile({ github }: { github: GithubActivity | null }) {
  if (!github) {
    return (
      <Tile core="flex flex-col justify-between gap-8 bg-surface p-6 md:p-7">
        <GithubLogo weight="light" size={28} className="text-ink" aria-hidden />
        <a
          href={PROFILE}
          target="_blank"
          rel="noopener noreferrer"
          className={`group inline-flex w-fit items-center gap-3 rounded-full bg-ink/5 py-2 pr-2 pl-5 text-base font-semibold text-ink transition-transform duration-300 ease-spring active:scale-[0.98] ${focusRing}`}
        >
          See what I&apos;m building
          <span className="flex size-8 items-center justify-center rounded-full bg-accent text-snow transition-transform duration-300 ease-spring group-hover:translate-x-0.5 group-hover:-translate-y-px">
            <ArrowUpRight weight="light" size={16} aria-hidden />
          </span>
        </a>
      </Tile>
    );
  }

  const { commits30d, repos30d, recent } = github;
  return (
    <Tile core="flex flex-col justify-between gap-5 bg-surface p-6 md:p-7">
      <div>
        <a href={PROFILE} target="_blank" rel="noopener noreferrer" className={`inline-flex rounded-full ${focusRing}`}>
          <GithubLogo weight="light" size={28} className="text-ink" aria-label="GitHub profile" />
        </a>
        <p className="mt-4 flex items-baseline gap-2">
          <span className="font-mono text-6xl leading-none font-medium tracking-tighter text-accent-ink">{commits30d}</span>
          <span className="text-xl font-semibold text-ink">{plural(commits30d, "commit")}</span>
        </p>
        <p className="mt-1 text-sm text-mute">
          across <span className="font-mono">{repos30d}</span> {plural(repos30d, "repo")}, last 30 days
        </p>
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
