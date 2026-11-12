import { useEffect } from "react";
import { leanFor } from "@/lib/motion/lean";

const LIFT = "-4px";

function tiles() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-board-grid] [data-tile]"));
}

function clearLean() {
  for (const t of tiles()) {
    t.style.removeProperty("--lean-x");
    t.style.removeProperty("--lean-y");
  }
}

function drop() {
  for (const t of tiles()) {
    t.style.removeProperty("--lift");
    delete t.dataset.lifted;
  }
}

/** Board tiles lean toward a mouse pointer and lift while pressed by any pointer; all off when `reduce` is true. */
export function useLean(reduce: boolean) {
  useEffect(() => {
    if (reduce) {
      clearLean();
      drop();
      return;
    }
    const fine = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;

    const paint = () => {
      frame = 0;
      if (!pointer) return;
      // All reads before any write, so the browser lays out once per frame instead of once per tile.
      const leans = tiles().map((t) => [t, leanFor(t.getBoundingClientRect(), pointer!)] as const);
      for (const [t, { x, y }] of leans) {
        t.style.setProperty("--lean-x", `${x.toFixed(2)}deg`);
        t.style.setProperty("--lean-y", `${y.toFixed(2)}deg`);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !fine.matches) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      pointer = null;
      clearLean();
    };
    const onDown = (e: PointerEvent) => {
      const tile = (e.target as Element | null)?.closest<HTMLElement>("[data-board-grid] [data-tile]");
      if (!tile) return;
      tile.style.setProperty("--lift", LIFT);
      tile.dataset.lifted = "";
    };

    document.documentElement.dataset.lean = "";
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    // A release outside the window sends no pointerup.
    window.addEventListener("blur", drop);
    return () => {
      delete document.documentElement.dataset.lean;
      window.removeEventListener("blur", drop);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
      clearLean();
      drop();
    };
  }, [reduce]);
}
