import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Repo } from "@/lib/github";
import { Tile } from "../Tile";

export function ProjectsTile({ repos }: { repos: Repo[] }) {
  return (
    <Tile core="flex flex-col gap-4 bg-surface p-6 md:flex-row md:items-center md:gap-8 md:p-7">
      <h2 className="text-xl font-semibold tracking-tight text-ink md:w-40 md:shrink-0">Live side projects</h2>
      <ul className="grid flex-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
        {repos.map((r) => (
          <li key={r.name}>
            <a
              href={r.homepage!}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full items-center justify-between gap-4 rounded-[calc(1.5rem-0.375rem-0.5rem)] bg-ink/[0.03] p-4 transition-colors duration-300 ease-spring hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold tracking-tight text-ink">{r.name}</span>
                {r.description && <span className="mt-1 line-clamp-2 block text-sm text-mute">{r.description}</span>}
              </span>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-snow transition-transform duration-300 ease-spring group-hover:translate-x-0.5 group-hover:-translate-y-px">
                <ArrowUpRight weight="light" size={16} aria-hidden />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
