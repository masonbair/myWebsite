"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { focusRing, focusRingOnColor, tag } from "@/components/ui/sticker";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { StickerFill } from "./copy";
import { fills } from "./fills";

const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";

// Both faces share one grid cell, so the sticker is as tall as its longer face and a flip never moves its neighbours.
export function FlipSticker({
  fill,
  title,
  front,
  back,
}: {
  fill: StickerFill;
  title: string;
  front: ReactNode;
  back: ReactNode;
}) {
  const [flipped, setFlipped] = useState(false);
  const card = useRef<HTMLElement>(null);
  const frontButton = useRef<HTMLButtonElement>(null);
  const backFace = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const backId = useId();
  const onColor = fill !== "surface";
  const button = `${tag} mt-auto inline-flex items-center gap-1.5 self-start text-xs after:absolute after:inset-0 after:content-[''] ${
    onColor ? `border-night bg-snow text-night ${focusRingOnColor}` : `border-line bg-canvas text-ink ${focusRing}`
  }`;

  // A flat squash, not a 3D turn: a 3D turn on a rounded, clipped sticker leaves seams at its corners.
  async function flip(next: boolean) {
    const el = card.current;
    if (el && !reduced) await el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: 130, easing: "ease-in" }).finished;
    flushSync(() => setFlipped(next));
    (next ? backFace : frontButton).current?.focus();
    if (el && !reduced) el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 280, easing: SPRING });
  }

  const face = "flex flex-col gap-5 p-5 [grid-area:1/1] md:p-6";
  return (
    <article
      ref={card}
      aria-label={title}
      className={`relative grid overflow-hidden rounded-2xl border-[2.5px] border-line shadow-sticker-sm ${fills[fill]}`}
    >
      <div className={`${face} ${flipped ? "invisible" : ""}`} inert={flipped}>
        {front}
        <button ref={frontButton} type="button" aria-expanded={false} aria-controls={backId} onClick={() => flip(true)} className={button}>
          <ArrowsClockwise weight="bold" size={13} aria-hidden />
          The story<span className="sr-only"> of {title}</span>
        </button>
      </div>
      <div ref={backFace} id={backId} tabIndex={-1} className={`${face} outline-none ${flipped ? "" : "invisible"}`} inert={!flipped}>
        {back}
        <button type="button" onClick={() => flip(false)} className={button}>
          <ArrowsClockwise weight="bold" size={13} aria-hidden />
          Flip back<span className="sr-only"> to {title}</span>
        </button>
      </div>
    </article>
  );
}
