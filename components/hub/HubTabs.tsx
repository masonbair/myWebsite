"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusRing } from "./styles";

const TABS = [
  { href: "/hub/capture", label: "Capture" },
  { href: "/hub", label: "Inbox" },
  { href: "/hub/list/todo", label: "Todo" },
  { href: "/hub/list/ideas", label: "Ideas" },
  { href: "/hub/now", label: "Now" },
  { href: "/hub/news", label: "News" },
];

export function HubTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Hub lists" className="max-w-full overflow-x-auto rounded-full [scrollbar-width:none]">
      <ul className="inline-flex w-max rounded-full bg-ink/5 p-1">
        {TABS.map((tab) => {
          const current = path === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`block rounded-full px-2.5 py-1.5 sm:px-4 text-sm font-medium transition-colors duration-300 ease-spring ${
                  current ? "bg-surface text-ink shadow-sm ring-1 ring-ink/5" : "text-mute hover:text-ink"
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
