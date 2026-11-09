"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export type NavLink = { label: string; href: string; external?: boolean; highlight?: boolean };

export function NavMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => wide.matches && setOpen(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const header = buttonRef.current?.closest("header");
    const behind = [...document.body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== header && !["SCRIPT", "NEXT-ROUTE-ANNOUNCER"].includes(el.tagName),
    );
    behind.forEach((el) => (el.inert = true));
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = previousOverflow;
      behind.forEach((el) => (el.inert = false));
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);


  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center rounded-full border-[2.5px] border-line bg-surface px-4 text-sm font-bold text-ink shadow-sticker-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent-ink active:translate-x-0.5 active:translate-y-0.5 active:shadow-none lg:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>
      {/* Always mounted so CSS can fade it out; `invisible` drops it from focus and the accessibility tree when closed. */}
      <div
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!open}
        className={`fixed inset-0 -z-10 bg-canvas transition-[opacity,visibility] duration-[350ms] ease-spring motion-reduce:transition-none lg:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <ul className="flex flex-col gap-2 px-6 pt-[calc(env(safe-area-inset-top,0px)+6.5rem)]">
          {links.map(({ label, href, external, highlight }, i) => (
            <li key={href} className="overflow-hidden">
              <a
                href={href}
                onClick={() => setOpen(false)}
                {...(external && { target: "_blank", rel: "noopener noreferrer" })}
                style={{ transitionDelay: open ? `${80 + i * 50}ms` : "0ms" }}
                className={`flex items-center gap-2 py-1 text-4xl font-bold tracking-tight outline-none transition-[translate,opacity] duration-600 ease-spring focus-visible:underline focus-visible:decoration-[3px] focus-visible:underline-offset-4 motion-reduce:transition-none ${
                  highlight ? "text-accent-ink" : "text-ink"
                } ${
                  open ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
                }`}
              >
                {label}
                {external && <ArrowUpRight weight="light" size={26} className="text-mute" aria-hidden />}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
