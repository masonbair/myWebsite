"use client";

import { Eraser, PencilSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { focusRing, stickerButtonShape } from "@/components/ui/sticker";

type Dot = { x: number; y: number; w: number };

const button = `${stickerButtonShape} pr-4 pl-4 text-sm border-line bg-surface text-ink ${focusRing}`;

/** Lets a visitor scribble over the board; strokes live only in memory and are kept in page coordinates so they scroll with it. */
export function Doodle() {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Dot[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const paint = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-accent-ink").trim();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of strokes.current) {
        for (let i = 1; i < stroke.length; i++) {
          const a = stroke[i - 1];
          const b = stroke[i];
          ctx.lineWidth = b.w;
          ctx.beginPath();
          ctx.moveTo(a.x - window.scrollX, a.y - window.scrollY);
          ctx.lineTo(b.x - window.scrollX, b.y - window.scrollY);
          ctx.stroke();
        }
      }
    };
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    };

    let current: Dot[] | null = null;
    // A marker's line is never perfectly even, so each point gets a slightly different width.
    const dot = (e: PointerEvent): Dot => ({ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY, w: 3.5 + Math.random() * 1.5 });
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      current = [dot(e)];
      strokes.current.push(current);
    };
    const onMove = (e: PointerEvent) => {
      if (!current) return;
      current.push(dot(e));
      setHasInk(true);
      paint();
    };
    const onUp = () => {
      current = null;
    };
    const clear = () => {
      strokes.current = [];
      setHasInk(false);
      paint();
    };

    size();
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("doodle:clear", clear);
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", size);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("doodle:clear", clear);
      window.removeEventListener("scroll", paint);
      window.removeEventListener("resize", size);
    };
  }, []);

  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);

  return (
    <>
      <canvas
        ref={ref}
        data-doodle
        aria-hidden="true"
        className={`fixed inset-0 z-30 h-screen w-screen ${drawing ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
      />
      <div className="fixed bottom-4 left-4 z-40 flex gap-2">
        <button
          type="button"
          aria-pressed={drawing}
          aria-label="Draw on the board"
          onClick={() => setDrawing((d) => !d)}
          className={`${button} aria-pressed:bg-accent aria-pressed:text-night`}
        >
          <PencilSimple weight="bold" size={18} aria-hidden />
          <span aria-hidden>Draw</span>
        </button>
        {(drawing || hasInk) && (
          <button
            type="button"
            onClick={() => ref.current?.dispatchEvent(new Event("doodle:clear"))}
            className={button}
            aria-label="Clear drawing"
          >
            <Eraser weight="bold" size={18} aria-hidden />
            <span aria-hidden>Clear</span>
          </button>
        )}
      </div>
    </>
  );
}
