import { useEffect } from "react";
import { leanFor } from "@/lib/motion/lean";

const LIFT = "-4px";
const TILE = "[data-tile]";
const LEAN_VARS = ["--lean-r", "--lean-dx", "--lean-dy"];

function tiles(scope: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(`${scope} ${TILE}`));
}

function clearLean(tile: HTMLElement | null) {
  for (const v of LEAN_VARS) tile?.style.removeProperty(v);
}

/** Only the tile under a mouse leans; any pointer lifts the tile it presses. `scope`: selector of the tiles' container. */
export function useLean(reduce: boolean, scope = "[data-board-grid]") {
  useEffect(() => {
    const drop = () => {
      for (const t of tiles(scope)) {
        t.style.removeProperty("--lift");
        delete t.dataset.lifted;
      }
    };
    if (reduce) {
      for (const t of tiles(scope)) clearLean(t);
      drop();
      return;
    }
    const fine = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    let hovered: HTMLElement | null = null;

    const tileAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>(`${scope} ${TILE}`) ?? null;
    const paint = () => {
      frame = 0;
      const next = pointer ? tileAt(pointer.x, pointer.y) : null;
      if (next !== hovered) clearLean(hovered);
      hovered = next;
      if (!hovered || !pointer) return;
      const { rotate, dx, dy } = leanFor(hovered.getBoundingClientRect(), pointer);
      hovered.style.setProperty("--lean-r", `${rotate.toFixed(2)}deg`);
      hovered.style.setProperty("--lean-dx", `${dx.toFixed(1)}px`);
      hovered.style.setProperty("--lean-dy", `${dy.toFixed(1)}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !fine.matches) return;
      pointer = { x: e.clientX, y: e.clientY };
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };
    // The page moved under a still mouse, so the tile under it may have changed.
    const onScroll = () => {
      if (pointer) schedule();
    };
    const onDown = (e: PointerEvent) => {
      const tile = (e.target as Element | null)?.closest<HTMLElement>(`${scope} ${TILE}`);
      if (!tile) return;
      tile.style.setProperty("--lift", LIFT);
      tile.dataset.lifted = "";
    };

    document.documentElement.dataset.lean = "";
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    // A release outside the window sends no pointerup.
    window.addEventListener("blur", drop);
    return () => {
      delete document.documentElement.dataset.lean;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
      window.removeEventListener("blur", drop);
      clearLean(hovered);
      drop();
    };
  }, [reduce, scope]);
}
