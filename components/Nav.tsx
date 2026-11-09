import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { NavActions } from "./NavActions";
import type { NavLink } from "./NavMenu";

// Root-relative so the section links also work from /coffee; on / they stay same-page jumps.
const links: NavLink[] = [
  { label: "About", href: "/#about" },
  { label: "Work", href: "/#projects" },
  { label: "Résumé", href: "/#resume" },
  { label: "GitHub", href: "https://github.com/masonbair", external: true },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/masonbair/", external: true },
];

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

export function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4 md:top-5">
      {/* Only the pill takes clicks, so game circles beside it stay reachable. */}
            <nav
        aria-label="Main"
        className="pointer-events-auto relative flex h-14 w-full items-center justify-between gap-6 rounded-full border-[2.5px] border-line bg-surface pr-1.5 pl-1.5 shadow-sticker-sm md:w-auto"
      >
        {/* A plain anchor keeps next/link (about 7 KB) off the home page; "/#" is a same-page jump to the top on /. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/#"
          className={`relative inline-flex -rotate-2 items-center rounded-xl border-[2.5px] border-line bg-surface px-3 py-0.5 text-lg font-bold tracking-tight text-ink shadow-sticker-sm ${focusRing}`}
        >
          mason bair
          <span aria-hidden className="caret text-accent-ink" />
        </a>
        <ul className="relative hidden items-center gap-1 md:flex">
          {links.map(({ label, href, external }) => (
            <li key={href}>
              <a
                href={href}
                {...(external && { target: "_blank", rel: "noopener noreferrer" })}
                className={`relative flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-semibold whitespace-nowrap text-mute before:absolute before:inset-0 before:rounded-full before:border-2 before:border-line before:bg-canvas before:opacity-0 before:transition-opacity before:duration-300 before:ease-spring hover:text-ink hover:before:opacity-100 ${focusRing}`}
              >
                {label}
                {external && <ArrowUpRight weight="light" size={13} aria-hidden />}
              </a>
            </li>
          ))}
        </ul>
        <NavActions links={links} />
      </nav>
    </header>
  );
}
