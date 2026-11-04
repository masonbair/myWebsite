"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Photo } from "@/lib/now";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { Tile } from "../Tile";

const INTERVAL_MS = 6000;

export function PhotoTile({ photos }: { photos: Photo[] }) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || hovered || photos.length < 2) return;
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
  }, [reduce, hovered, photos.length]);

  return (
    <Tile core="aspect-[4/5] bg-ink/5 md:aspect-auto md:min-h-[22rem] lg:min-h-0">
      <div className="absolute inset-0" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {photos.map((p, i) => (
          <Image
            key={p.src}
            src={p.src}
            alt={p.alt}
            aria-hidden={i !== active}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 100vw"
            className={`object-cover transition-opacity duration-[1200ms] ease-spring motion-reduce:transition-none ${
              i === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>
    </Tile>
  );
}
