"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Renders its children everywhere except the private hub, which has its own header. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const path = usePathname();
  return path === "/hub" || path.startsWith("/hub/") ? null : children;
}
