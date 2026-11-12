"use client";

import { useEffect, useRef } from "react";
import { dotPush } from "@/lib/motion/dots";
import type { Point } from "@/lib/motion/lean";

// Must match the body background in app/globals.css: an 18px grid with a 1.2px dot centred in each cell.
const GRID = 18;
const DOT_RADIUS = 1.2;
const REACH = 120;
const EASE = 0.18;

/** Redraws the page's background dots on a canvas so they bend away from a mouse pointer; the CSS dots are hidden while it runs. */
export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const root = document.documentElement;
    let color = "";
    let target: Point | null = null;
    let shown: Point | null = null;
    let strength = 0;
    let frame = 0;

    const readColor = () => {
      color = getComputedStyle(root).getPropertyValue("--color-dot").trim();
    };

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = color;
      ctx.beginPath();
      const offsetY = -(window.scrollY % GRID);
      const pointer = shown && strength > 0.01 ? shown : null;
      for (let y = GRID / 2 + offsetY; y < window.innerHeight + GRID; y += GRID) {
        for (let x = GRID / 2; x < window.innerWidth + GRID; x += GRID) {
          const near = pointer && Math.abs(x - pointer.x) < REACH && Math.abs(y - pointer.y) < REACH;
          const { dx, dy } = near ? dotPush({ x, y }, pointer) : { dx: 0, dy: 0 };
          ctx.moveTo(x + dx * strength + DOT_RADIUS, y + dy * strength);
          ctx.arc(x + dx * strength, y + dy * strength, DOT_RADIUS, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    };

    const setRunning = (on: boolean) => {
      canvas.dataset.running = String(on);
    };

    const tick = () => {
      frame = 0;
      const goal = target ? 1 : 0;
      strength += (goal - strength) * EASE;
      if (target) shown = shown ? { x: shown.x + (target.x - shown.x) * EASE * 2, y: shown.y + (target.y - shown.y) * EASE * 2 } : target;
      draw();
      const settled =
        Math.abs(goal - strength) < 0.01 && (!target || !shown || Math.hypot(target.x - shown.x, target.y - shown.y) < 0.5);
      if (settled) {
        strength = goal;
        if (target) shown = target;
        draw();
        setRunning(false);
      } else {
        frame = requestAnimationFrame(tick);
      }
    };

    const wake = () => {
      if (document.visibilityState !== "visible") return;
      setRunning(true);
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      target = { x: e.clientX, y: e.clientY };
      wake();
    };
    const onLeave = () => {
      target = null;
      wake();
    };
    const onResize = () => {
      size();
      draw();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") return;
      cancelAnimationFrame(frame);
      frame = 0;
      setRunning(false);
    };
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
      readColor();
      draw();
    };

    readColor();
    size();
    draw();
    setRunning(false);
    root.dataset.dots = "";

    window.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    scheme.addEventListener("change", onScheme);
    return () => {
      cancelAnimationFrame(frame);
      delete root.dataset.dots;
      window.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      scheme.removeEventListener("change", onScheme);
    };
  }, []);

  return (
    <canvas ref={ref} data-dots aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 h-screen w-screen" />
  );
}
