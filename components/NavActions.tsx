"use client";

import { usePathname } from "next/navigation";
import { LazyScorePill } from "./game/LazyGame";
import { NavMenu, type NavLink } from "./NavMenu";

// The game lives on the home page only; elsewhere the cluster hides on desktop so the nav keeps no empty gap.
export function NavActions({ links }: { links: NavLink[] }) {
  const home = usePathname() === "/";
  return (
    <div className={`relative flex items-center gap-2 ${home ? "" : "md:hidden"}`}>
      {home && <LazyScorePill />}
      <NavMenu links={links} />
    </div>
  );
}
