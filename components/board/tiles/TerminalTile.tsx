import type { TerminalData } from "@/lib/terminal";
import { Prompt, Tile } from "../Tile";
import { TERMINAL_GREETING } from "./terminal-copy";

/** A still terminal; the board's lazy effects mount the working prompt into its slot (motion/TerminalMount.tsx). */
export function TerminalTile({ data }: { data: TerminalData }) {
  return (
    <section aria-labelledby="terminal-tile-title" className="h-full">
      <Tile core="flex min-h-[17.5rem] flex-col gap-3 bg-night p-6 text-snow md:p-7">
        <div>
          <Prompt className="text-snow/70">ssh mason@board</Prompt>
          <h2 id="terminal-tile-title" className="mt-2 text-xl font-bold tracking-tight">
            Poke around
          </h2>
        </div>
        <div data-terminal-slot data-terminal={JSON.stringify(data)} className="flex min-h-0 flex-1 flex-col">
          <div data-terminal-placeholder aria-hidden className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="flex-1 font-mono text-sm leading-relaxed text-snow">{TERMINAL_GREETING}</p>
            <p className="flex items-center gap-2 border-t-2 border-dashed border-snow/30 pt-3 font-mono text-base md:text-sm">
              <span className="text-accent">$</span>
              <span className="px-1 py-1 text-snow/60">help</span>
            </p>
          </div>
        </div>
      </Tile>
    </section>
  );
}
