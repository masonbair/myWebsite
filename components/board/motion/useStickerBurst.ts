import { useEffect } from "react";

const COUNT = 12;
const FILLS = ["--color-accent", "--color-tea", "--color-rose", "--color-surface"];

function burst(x: number, y: number) {
  for (let i = 0; i < COUNT; i++) {
    const s = document.createElement("span");
    s.dataset.burstSticker = "";
    s.className = "burst-sticker";
    s.setAttribute("aria-hidden", "true");
    const size = 10 + Math.random() * 8;
    Object.assign(s.style, {
      left: `${x - size / 2}px`,
      top: `${y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: `var(${FILLS[i % FILLS.length]})`,
    });
    document.body.appendChild(s);
    const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const reach = 50 + Math.random() * 50;
    s.animate(
      [
        { transform: "translate(0, 0) rotate(0deg) scale(0.6)", opacity: 1 },
        { transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach + 30}px) rotate(${Math.random() * 360 - 180}deg) scale(1)`, opacity: 0 },
      ],
      { duration: 650 + Math.random() * 200, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    ).onfinish = () => s.remove();
  }
}

/** Throws a handful of stickers from any `[data-burst]` link when it's clicked; never holds up the navigation. */
export function useStickerBurst(reduce: boolean) {
  useEffect(() => {
    if (reduce) return;
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest("[data-burst]");
      if (!link) return;
      const box = link.getBoundingClientRect();
      // A keyboard "click" has no pointer position, so the burst comes from the button's center.
      const fromPointer = e.detail > 0;
      burst(fromPointer ? e.clientX : box.left + box.width / 2, fromPointer ? e.clientY : box.top + box.height / 2);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [reduce]);
}
