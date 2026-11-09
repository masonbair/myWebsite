"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import type { NavLink } from "./NavMenu";
import { focusRing } from "./ui/sticker";

/** Which link names the page in view: the board on /, the coffee page on /coffee. */
export function isCurrent(href: string, path: string) {
  return (path === "/" && href === "/#") || href === path;
}

/** Desktop links in one sticker pill; the current page shows as an outlined pill. */
export function NavLinks({ links }: { links: NavLink[] }) {
  const path = usePathname();
  return (
    <ul className="pointer-events-auto hidden items-center gap-0.5 rounded-full border-[2.5px] border-line bg-surface p-1 shadow-sticker-sm lg:flex">
      {links.map(({ label, href, external, highlight }) => {
        const current = isCurrent(href, path);
        return (
          <li key={href}>
            <a
              href={href}
              aria-current={current ? "page" : undefined}
              {...(external && { target: "_blank", rel: "noopener noreferrer" })}
              className={`flex items-center gap-1 rounded-full border-2 px-3 py-1 text-sm font-semibold whitespace-nowrap transition-colors duration-200 ease-spring ${
                highlight
                  ? "border-line bg-tea text-night"
                  : current
                    ? "border-line bg-canvas text-ink"
                    : "border-transparent text-mute hover:border-line/30 hover:text-ink"
              } ${focusRing}`}
            >
              {label}
              {external && <ArrowUpRight weight="bold" size={12} aria-hidden />}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
