"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { WalkCard } from "@/lib/walk/deck";
import { panel, primaryButton } from "./styles";

/** One prompt at a time; Next wraps around, all on the phone, so it works with no signal. */
export function WalkDeck({ cards }: { cards: WalkCard[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (navigator.onLine) navigator.serviceWorker?.controller?.postMessage({ savePage: "/hub/walk" });
  }, []);
  const card = cards[index];
  return (
    <section aria-label="Walk prompt" className={`${panel} flex min-h-[45svh] flex-col p-6 sm:p-8`}>
      <p className="font-mono text-xs font-medium text-mute">
        {index + 1} of {cards.length}
      </p>
      <p aria-live="polite" className="mt-6 flex-1 text-3xl leading-tight font-semibold tracking-tight text-balance text-ink sm:text-4xl">
        {card.prompt}
      </p>
      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-sm text-mute">{card.from ? `From your notes: ${card.from}` : "Starter"}</p>
        <button type="button" className={primaryButton} onClick={() => setIndex((i) => (i + 1) % cards.length)}>
          Next
          <ArrowRight size={16} weight="bold" aria-hidden />
        </button>
      </div>
    </section>
  );
}
