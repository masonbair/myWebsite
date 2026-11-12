"use client";

import { Eraser, PencilSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { focusRing, stickerButtonShape } from "@/components/ui/sticker";

type Dot = { x: number; y: number; w: number };

const MAX_DPR = 2;
const button = `${stickerButtonShape} pr-4 pl-4 text-sm border-line bg-surface text-ink ${focusRing}`;

/** Lets a visitor scribble on the board; strokes live only in memory, in the canvas's own coordinates, and the canvas scrolls with the board. */
export function Doodle() {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Dot[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  // A board-sized canvas is tens of MB on a phone, so it gets its pixels only once someone starts drawing.
  const [armed, setArmed] = useState(false);
  if (drawing && !armed) setArmed(true);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!armed || !canvas || !ctx) return;

    const paint = () => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-accent-ink").trim();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of strokes.current) {
        for (let i = 1; i < stroke.length; i++) {
          const a = stroke[i - 1];
          const b = stroke[i];
          ctx.lineWidth = b.w;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    };
    const size = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    };

    let current: Dot[] | null = null;
    // A marker's line is never perfectly even, so each point gets a slightly different width.
    const dot = (e: PointerEvent): Dot => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top, w: 3.5 + Math.random() * 1.5 };
    };
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
    // The board's height changes as tiles load and on rotation.
    const resized = new ResizeObserver(size);
    resized.observe(canvas);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("doodle:clear", clear);
      resized.disconnect();
    };
  }, [armed]);

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
        className={`absolute inset-0 z-30 size-full ${drawing ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
      />
      {/* In the page under the board, in a slot Board reserves, so the buttons never sit on a tile or shift the layout; z-40 keeps them above the drawing canvas. */}
      <div className="relative z-40 flex gap-2">
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
