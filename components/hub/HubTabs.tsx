"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusRing } from "./styles";

const TABS = [
  { href: "/hub/capture", label: "Capture" },
  { href: "/hub", label: "Inbox" },
  { href: "/hub/list/todo", label: "Todo" },
  { href: "/hub/ideas", label: "Ideas" },
  { href: "/hub/now", label: "Now" },
];

export function HubTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Hub lists">
      <ul className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => {
          const current = path === tab.href || (tab.href === "/hub/ideas" && path.startsWith("/hub/ideas/"));
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`block rounded-full border-2 border-line px-3 py-1 text-sm font-bold transition-colors duration-200 ease-spring sm:px-3.5 ${
                  current ? "bg-ink text-canvas" : "bg-surface text-ink hover:bg-canvas"
                } ${focusRing}`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
