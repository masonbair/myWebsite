import type { TerminalData } from "@/lib/terminal";
import { Prompt, Tile } from "../Tile";
import { TerminalPrompt } from "./TerminalPrompt";

/** A real little terminal on the board; it only knows what the other tiles already show. */
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
        <TerminalPrompt data={data} />
      </Tile>
    </section>
  );
}
