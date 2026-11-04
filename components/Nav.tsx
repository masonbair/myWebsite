import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { NavMenu, type NavLink } from "./NavMenu";

const links: NavLink[] = [
  { label: "About", href: "#about" },
  { label: "Work", href: "#projects" },
  { label: "Résumé", href: "#resume" },
  { label: "GitHub", href: "https://github.com/masonbair", external: true },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/masonbair/", external: true },
];

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-3 z-50 flex justify-center px-4 md:top-5">
      {/* The blur sits on ::before because backdrop-filter on the nav itself would trap the fixed mobile overlay inside the pill. */}
      <nav
        aria-label="Main"
        className="relative flex h-14 w-full items-center justify-between gap-6 rounded-full pr-2 pl-5 before:absolute before:inset-0 before:rounded-full before:bg-surface/75 before:shadow-tile before:ring-1 before:ring-ink/5 before:backdrop-blur-xl md:w-auto"
      >
        <a
          href="#"
          className={`relative rounded-full text-[15px] font-semibold tracking-tight text-ink ${focusRing}`}
        >
          Mason Bair
        </a>
        <ul className="relative hidden items-center gap-1 md:flex">
          {links.map(({ label, href, external }) => (
            <li key={href}>
              <a
                href={href}
                {...(external && { target: "_blank", rel: "noopener noreferrer" })}
                className={`flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap text-mute transition-colors duration-300 ease-spring hover:bg-ink/5 hover:text-ink ${focusRing}`}
              >
                {label}
                {external && <ArrowUpRight weight="light" size={13} aria-hidden />}
              </a>
            </li>
          ))}
        </ul>
        <NavMenu links={links} />
      </nav>
    </header>
  );
}
