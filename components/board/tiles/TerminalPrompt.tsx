"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { focusRingOnNight } from "@/components/ui/sticker";
import type { TerminalData } from "@/lib/terminal";
import { TERMINAL_GREETING } from "./terminal-copy";

const MAX_LINES = 14;

type Line = { id: number; text: string };

/** A working prompt; the command code loads on the first command, so it never weighs on the page's first load. */
export function TerminalPrompt({ data }: { data: TerminalData }) {
  const nextId = useRef(1);
  const [lines, setLines] = useState<Line[]>([{ id: 0, text: TERMINAL_GREETING }]);
  const [value, setValue] = useState("");
  const inputId = useId();
  const log = useRef<HTMLDivElement>(null);

  // Stable ids, so trimming old lines never makes the live log re-announce the ones still shown.
  const append = (texts: string[]) =>
    setLines((prev) => [...prev, ...texts.map((text) => ({ id: nextId.current++, text }))].slice(-MAX_LINES));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const command = value;
    setValue("");
    if (command.trim().toLowerCase() === "clear") {
      setLines([]);
      return;
    }
    let output: string[];
    try {
      const { runCommand } = await import("@/lib/terminal");
      output = runCommand(command, data);
    } catch {
      output = ["Couldn't load the commands. Check your connection and try again."];
    }
    append([`$ ${command.trim()}`, ...output]);
    requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight }));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={log} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-wrap text-snow">
        {lines.map((line) => (
          <p key={line.id} className="[overflow-wrap:anywhere]">
            {line.text}
          </p>
        ))}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t-2 border-dashed border-snow/30 pt-3">
        <label htmlFor={inputId} className="sr-only">
          Type a command
        </label>
        <span aria-hidden className="font-mono text-sm text-accent">
          $
        </span>
        {/* 16px on phones: iOS zooms into any field with smaller text on focus. */}
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="help"
          className={`min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 font-mono text-base text-snow placeholder:text-snow/60 md:text-sm ${focusRingOnNight}`}
        />
      </form>
    </div>
  );
}
