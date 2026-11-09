"use client";

import { Pause, Play } from "@phosphor-icons/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { collectorPhotoLoader, isCollectorPhotoSrc } from "@/lib/collector-photos";
import type { Photo } from "@/lib/now";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { Tile } from "../Tile";

const INTERVAL_MS = 6000;

// Waits for load and then idle time, so the extra photos never compete with the hero photo.
function useAfterFirstPaint(enabled: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let idleId: number | undefined;
    const idle = () => {
      idleId = (window.requestIdleCallback ?? setTimeout)(() => setReady(true)) as number;
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      window.removeEventListener("load", idle);
      if (idleId !== undefined) (window.cancelIdleCallback ?? clearTimeout)(idleId);
    };
  }, [enabled]);
  return ready;
}

export function PhotoTile({ photos }: { photos: Photo[] }) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const rotates = !reduce && photos.length > 1;
  const restLoaded = useAfterFirstPaint(rotates);
  const shown = restLoaded ? photos : photos.slice(0, 1);

  useEffect(() => {
    if (!rotates || !restLoaded || hovered || focused || paused) return;
    let timer: number | undefined;
    const stop = () => {
      window.clearInterval(timer);
      timer = undefined;
    };
    const sync = () => {
      stop();
      if (document.visibilityState === "visible") {
        timer = window.setInterval(() => setActive((i) => (i + 1) % photos.length), INTERVAL_MS);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [rotates, restLoaded, hovered, focused, paused, photos.length]);

  return (
    <Tile core="aspect-[4/5] bg-ink/5 md:aspect-auto md:min-h-[22rem] lg:min-h-0">
      <div
        role="group"
        aria-label="Photo slideshow"
        className="absolute inset-0"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {shown.map((p, i) => (
          <Image
            key={p.src}
            src={p.src}
            loader={isCollectorPhotoSrc(p.src) ? collectorPhotoLoader : undefined}
            alt={p.alt}
            aria-hidden={i !== active}
            fill
            loading={i === 0 ? "eager" : "lazy"}
            // Low priority also stops React adding a preload that would jump ahead of the hero photo.
            fetchPriority="low"
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 100vw"
            className={`object-cover transition-opacity duration-[1200ms] ease-spring motion-reduce:transition-none ${
              i === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        {rotates && restLoaded && (
          <button
            type="button"
            aria-label="Pause photo slideshow"
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
            className="absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-full bg-night/55 text-snow outline-none transition-transform duration-300 ease-spring active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-snow"
          >
            {paused ? <Play weight="light" size={20} aria-hidden /> : <Pause weight="light" size={20} aria-hidden />}
          </button>
        )}
      </div>
    </Tile>
  );
}
