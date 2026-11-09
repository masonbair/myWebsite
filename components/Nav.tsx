import { NavActions } from "./NavActions";
import { NavLinks } from "./NavLinks";
import type { NavLink } from "./NavMenu";
import { focusRing } from "./ui/sticker";

// Root-relative so the section links also work from /coffee; on / they stay same-page jumps.
const links: NavLink[] = [
  { label: "Now", href: "/#" },
  { label: "About", href: "/#about" },
  { label: "Work", href: "/#projects" },
  { label: "Résumé", href: "/#resume" },
  { label: "Coffee", href: "/coffee", highlight: true },
  { label: "GitHub", href: "https://github.com/masonbair", external: true },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/masonbair/", external: true },
];

export function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] md:pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
      {/* Only the stickers take clicks, so game circles in the gaps stay reachable. */}
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] md:px-8"
      >
        {/* A plain anchor keeps next/link (about 7 KB) off the home page; "/#" is a same-page jump to the top on /. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/#"
          className={`pointer-events-auto inline-flex shrink-0 -rotate-2 items-center rounded-xl border-[2.5px] border-line bg-surface px-3 py-1 text-lg leading-tight font-bold tracking-tight text-ink shadow-sticker-sm md:text-xl ${focusRing}`}
        >
          mason bair
          <span aria-hidden className="caret text-accent-ink" />
        </a>
        <div className="flex items-center gap-2">
          <NavLinks links={links} />
          <NavActions links={links} />
        </div>
      </nav>
    </header>
  );
}
