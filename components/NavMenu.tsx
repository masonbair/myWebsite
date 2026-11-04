"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

export type NavLink = { label: string; href: string; external?: boolean };

const ease = [0.32, 0.72, 0, 1] as const;

export function NavMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => wide.matches && setOpen(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const bar =
    "absolute left-1/2 h-px w-[18px] -translate-x-1/2 bg-ink transition-transform duration-500 ease-spring motion-reduce:transition-none";

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="relative size-10 rounded-full bg-ink/5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.96] md:hidden"
      >
        <span className={`${bar} top-1/2 ${open ? "rotate-45" : "-translate-y-[3.5px]"}`} />
        <span className={`${bar} top-1/2 ${open ? "-rotate-45" : "translate-y-[3.5px]"}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.35, ease }}
            className="fixed inset-0 -z-10 bg-canvas/85 backdrop-blur-2xl md:hidden"
          >
            <ul className="flex flex-col gap-2 px-6 pt-28">
              {links.map(({ label, href, external }, i) => (
                <li key={href} className="overflow-hidden">
                  <motion.a
                    href={href}
                    onClick={() => setOpen(false)}
                    {...(external && { target: "_blank", rel: "noopener noreferrer" })}
                    initial={reduce ? false : { y: "100%", opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 0.08 + i * 0.05, ease }}
                    className="flex items-center gap-2 py-1 text-4xl font-semibold tracking-tight text-ink outline-none focus-visible:text-accent-ink"
                  >
                    {label}
                    {external && <ArrowUpRight weight="light" size={26} className="text-mute" aria-hidden />}
                  </motion.a>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
