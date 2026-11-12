"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TerminalData } from "@/lib/terminal";
import { TerminalPrompt } from "../tiles/TerminalPrompt";

type Slot = { el: HTMLElement; data: TerminalData };

// Only ever rendered in the browser: it arrives with the lazy board effects, never in server HTML.
function findSlot(): Slot | null {
  const el = document.querySelector<HTMLElement>("[data-terminal-slot]");
  const raw = el?.dataset.terminal;
  return el && raw ? { el, data: JSON.parse(raw) as TerminalData } : null;
}

/** Puts the working terminal into the server-drawn slot, if this page has one; part of the lazy effects, so off the first load. */
export function TerminalMount() {
  const [slot] = useState(findSlot);

  useEffect(() => {
    const el = slot?.el;
    if (!el) return;
    el.toggleAttribute("data-live", true);
    return () => el.removeAttribute("data-live");
  }, [slot]);

  return slot ? createPortal(<TerminalPrompt data={slot.data} />, slot.el) : null;
}
