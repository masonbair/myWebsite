"use client";

import { Pause, Play } from "@phosphor-icons/react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CAT_STAGE_LINES, catStage } from "@/lib/cat";
import { Cat } from "./Cat";
import { game, useGame } from "./store";

type Spot = { x: number; y: number; size: number };
type Circle = Spot & { id: number };

const EDGE = 16;
const ease = [0.32, 0.72, 0, 1] as const;

const overlaps = (s: Spot, r: DOMRect) =>
  s.x < r.right && s.x + s.size > r.left && s.y < r.bottom && s.y + s.size > r.top;

const inflate = (r: DOMRect, by: number) => new DOMRect(r.x - by, r.y - by, r.width + by * 2, r.height + by * 2);

// Uses the visual viewport so pinch-zoom and mobile toolbars count; fixed elements are placed in layout-viewport pixels.
function playArea() {
  const vv = window.visualViewport;
  const left = vv?.offsetLeft ?? 0;
  const top = vv?.offsetTop ?? 0;
  const width = vv?.width ?? document.documentElement.clientWidth;
  const height = vv?.height ?? document.documentElement.clientHeight;
  const size = width <= 500 ? 48 : width <= 800 ? 56 : 64;
  const navBottom = document.querySelector('nav[aria-label="Main"]')?.getBoundingClientRect().bottom ?? 72;
  const minX = left + EDGE;
  const maxX = Math.max(minX, left + width - size - EDGE);
  // On a very short viewport staying on screen wins over clearing the nav.
  const maxY = Math.max(top, top + height - size - EDGE);
  const minY = Math.min(Math.max(top + EDGE, navBottom + EDGE), maxY);
  return { minX, maxX, minY, maxY, size };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Random spot fully inside the viewport, below the nav pill and away from `avoid`. */
function randomSpot(avoid: DOMRect[]): Spot {
  const { minX, maxX, minY, maxY, size } = playArea();
  let spot: Spot = { x: minX, y: minY, size };
  for (let i = 0; i < 30; i++) {
    spot = { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY), size };
    if (!avoid.some((r) => overlaps(spot, r))) break;
  }
  return spot;
}

/** Keeps a live circle where it is when it still fits, otherwise clamps or re-places it. */
function refit(spot: Spot, avoid: DOMRect[]): Spot {
  const { minX, maxX, minY, maxY, size } = playArea();
  const next = { x: clamp(spot.x, minX, maxX), y: clamp(spot.y, minY, maxY), size };
  return avoid.some((r) => overlaps(next, r)) ? randomSpot(avoid) : next;
}

/** The cat-builder game: the corner cat toggles play, each caught circle scores a point. */
export function CatGame() {
  const { score, playing, color } = useGame();
  const reduce = useReducedMotion();
  const [circle, setCircle] = useState<Circle | null>(null);
  const [pops, setPops] = useState<Circle[]>([]);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [burst, setBurst] = useState(0);
  const [catScope, animateCat] = useAnimate<HTMLButtonElement>();
  const nextDelay = useRef(350);
  const focusNext = useRef(false);
  const circleRef = useRef<HTMLButtonElement>(null);
  const stage = catStage(score);
  const circleId = circle?.id;

  useEffect(() => {
    game.init();
  }, []);

  useEffect(() => {
    if (!playing || circle) return;
    const avoid = [inflate(catScope.current!.getBoundingClientRect(), 24)];
    const t = setTimeout(() => setCircle({ id: Date.now(), ...randomSpot(avoid) }), nextDelay.current);
    return () => clearTimeout(t);
  }, [playing, circle, catScope]);

  useEffect(() => {
    if (circleId === undefined) return;
    if (focusNext.current) circleRef.current?.focus();
    const onResize = () =>
      setCircle((c) => c && { ...c, ...refit(c, [inflate(catScope.current!.getBoundingClientRect(), 24)]) });
    const vv = window.visualViewport;
    window.addEventListener("resize", onResize);
    vv?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
    };
  }, [circleId, catScope]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  function togglePlay(fromKeyboard: boolean) {
    if (playing) setCircle(null);
    else {
      nextDelay.current = 350;
      focusNext.current = fromKeyboard;
      if (score === 0) setToast({ id: Date.now(), text: CAT_STAGE_LINES[0] });
    }
    game.togglePlay();
  }

  function catchCircle(c: Circle, fromKeyboard: boolean) {
    focusNext.current = fromKeyboard;
    setCircle(null);
    if (!reduce) setPops((p) => [...p, c]);
    nextDelay.current = 500 + Math.random() * 900;
    game.scorePoint();
    const next = catStage(score + 1);
    if (next > stage) {
      setToast({ id: Date.now(), text: CAT_STAGE_LINES[next] });
      if (!reduce) {
        setBurst((b) => b + 1);
        animateCat(catScope.current, { scale: [1, 1.18, 1] }, { duration: 0.55, ease });
      }
    }
  }

  return (
    <>
      {circle && (
          <motion.button
            ref={circleRef}
            key={circle.id}
            type="button"
            aria-label="Catch the circle"
            // detail is 0 for Enter/Space, so keyboard players keep focus on the next circle.
            onClick={(e) => catchCircle(circle, e.detail === 0)}
            initial={reduce ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            style={{ left: circle.x, top: circle.y, width: circle.size, height: circle.size }}
            className="fixed z-40 cursor-pointer rounded-full bg-[radial-gradient(circle_at_32%_28%,var(--color-tea),var(--color-accent)_70%)] shadow-tile ring-4 ring-surface outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          />
      )}
      {pops.map((p) => (
        <motion.span
          key={p.id}
          aria-hidden
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.45, ease }}
          onAnimationComplete={() => setPops((all) => all.filter((x) => x.id !== p.id))}
          style={{ left: p.x, top: p.y, width: p.size, height: p.size }}
          className="pointer-events-none fixed z-40 rounded-full ring-2 ring-accent"
        />
      ))}

      <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 md:right-6 md:bottom-6">
        <div role="status" aria-live="polite" className="flex justify-end">
          <AnimatePresence mode="popLayout">
            {toast && (
              <motion.p
                key={toast.id}
                initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: reduce ? 0 : 6 }}
                transition={{ duration: reduce ? 0 : 0.4, ease }}
                className="max-w-[min(20rem,calc(100vw-2rem))] rounded-tile bg-surface px-4 py-3 text-sm leading-snug font-medium text-ink shadow-tile ring-1 ring-ink/5"
              >
                {toast.text}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="relative flex flex-col items-end gap-1.5 min-[501px]:flex-row min-[501px]:gap-2">
          <AnimatePresence>
            {color && !playing && score === 0 && (
              <motion.span
                aria-hidden
                initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1, transition: { delay: reduce ? 0 : 1.2, duration: 0.5, ease } }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-ink shadow-tile ring-1 ring-ink/5 min-[501px]:mb-3 min-[501px]:px-3.5 min-[501px]:py-2 min-[501px]:text-xs"
              >
                Play with me
              </motion.span>
            )}
          </AnimatePresence>

          <motion.button
            ref={catScope}
            type="button"
            aria-label={playing ? "Pause the cat game" : "Start the cat game"}
            onClick={(e) => togglePlay(e.detail === 0)}
            initial={false}
            animate={{ opacity: color ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.5, ease }}
            className="group pointer-events-auto relative size-[58px] cursor-pointer rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent min-[501px]:size-20"
          >
            <span className="block transition-transform duration-300 ease-spring group-hover:-translate-y-0.5 group-active:scale-95 motion-reduce:transition-none">
              {color && <Cat stage={stage} color={color} />}
            </span>
            {color && (playing || score > 0) && (
              <span className="absolute -top-1 -left-1 grid size-6 place-items-center rounded-full bg-surface text-ink shadow-tile ring-1 ring-ink/10">
                {playing ? <Pause weight="light" size={12} /> : <Play weight="light" size={12} />}
              </span>
            )}
            {burst > 0 && <Burst key={burst} />}
          </motion.button>
        </div>
      </div>
    </>
  );
}

const RAYS = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);

function Burst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      <motion.span
        className="absolute size-16 rounded-full ring-2 ring-accent"
        initial={{ scale: 0.6, opacity: 0.9 }}
        animate={{ scale: 1.9, opacity: 0 }}
        transition={{ duration: 0.7, ease }}
      />
      {RAYS.map((a, i) => (
        <motion.span
          key={a}
          className={`absolute size-2 rounded-full ${["bg-accent", "bg-tea", "bg-rose"][i % 3]}`}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: Math.cos(a) * 52, y: Math.sin(a) * 52, opacity: 0, scale: 0.4 }}
          transition={{ duration: 0.75, ease }}
        />
      ))}
    </span>
  );
}
