"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { TerminalData } from "@/lib/terminal";

const MAX_LINES = 14;
const GREETING = "Type help and hit enter.";

/** A working prompt; the command code loads on the first command, so it never weighs on the page's first load. */
export function TerminalPrompt({ data }: { data: TerminalData }) {
  const [lines, setLines] = useState<string[]>([GREETING]);
  const [value, setValue] = useState("");
  const inputId = useId();
  const log = useRef<HTMLDivElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const command = value;
    setValue("");
    if (command.trim().toLowerCase() === "clear") {
      setLines([]);
      return;
    }
    const { runCommand } = await import("@/lib/terminal");
    setLines((prev) => [...prev, `$ ${command.trim()}`, ...runCommand(command, data)].slice(-MAX_LINES));
    requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight }));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={log} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-wrap text-snow">
        {lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t-2 border-dashed border-snow/30 pt-3">
        <label htmlFor={inputId} className="sr-only">
          Type a command
        </label>
        <span aria-hidden className="font-mono text-sm text-accent">
          $
        </span>
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="help"
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 font-mono text-sm text-snow placeholder:text-snow/60 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-snow"
        />
      </form>
    </div>
  );
}
