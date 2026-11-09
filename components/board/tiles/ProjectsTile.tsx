import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Repo } from "@/lib/github";

type LiveRepo = Repo & { homepage: string };
import { Tile } from "../Tile";

export function ProjectsTile({ repos }: { repos: LiveRepo[] }) {
  return (
    <Tile core="flex flex-col gap-4 bg-rose p-6 md:flex-row md:items-center md:gap-8 md:p-7">
      <h2 className="text-xl font-bold tracking-tight text-night md:w-40 md:shrink-0">Live side projects</h2>
      <ul className="grid flex-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
        {repos.map((r) => (
          <li key={r.name}>
            <a
              href={r.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex h-full items-center justify-between gap-4 rounded-xl border-2 border-line bg-surface p-4 shadow-sticker-sm focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-night"
            >
              <span
                aria-hidden
                className="absolute inset-0 rounded-[inherit] bg-ink/[0.03] opacity-0 transition-opacity duration-300 ease-spring group-hover:opacity-100"
              />
              <span className="relative min-w-0">
                <span className="block truncate text-lg font-semibold tracking-tight text-ink">{r.name}</span>
                {r.description && <span className="mt-1 line-clamp-2 block text-sm text-mute">{r.description}</span>}
              </span>
              <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-line bg-accent text-night transition-transform duration-300 ease-spring group-hover:translate-x-0.5 group-hover:-translate-y-px">
                <ArrowUpRight weight="light" size={16} aria-hidden />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
