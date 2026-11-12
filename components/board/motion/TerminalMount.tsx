"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TerminalData } from "@/lib/terminal";
import { TerminalPrompt } from "../tiles/TerminalPrompt";

/** Puts the working terminal into the server-drawn slot, if this page has one; part of the lazy effects, so off the first load. */
export function TerminalMount() {
  const [slot, setSlot] = useState<{ el: HTMLElement; data: TerminalData } | null>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-terminal-slot]");
    const raw = el?.dataset.terminal;
    if (!el || !raw) return;
    el.dataset.live = "";
    setSlot({ el, data: JSON.parse(raw) as TerminalData });
    return () => {
      delete el.dataset.live;
    };
  }, []);

  return slot ? createPortal(<TerminalPrompt data={slot.data} />, slot.el) : null;
}
