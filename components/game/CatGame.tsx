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

// Random spot fully inside the viewport, below the nav pill and away from the cat corner.
function randomSpot(avoid: DOMRect[]): Spot {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const size = vw <= 500 ? 48 : vw <= 800 ? 56 : 64;
  const navBottom = document.querySelector('nav[aria-label="Main"]')?.getBoundingClientRect().bottom ?? 72;
  const minY = navBottom + EDGE;
  const maxX = vw - size - EDGE;
  const maxY = Math.max(minY, vh - size - EDGE);
  let spot: Spot = { x: EDGE, y: minY, size };
  for (let i = 0; i < 30; i++) {
    spot = { x: EDGE + Math.random() * (maxX - EDGE), y: minY + Math.random() * (maxY - minY), size };
    if (!avoid.some((r) => overlaps(spot, r))) break;
  }
  return spot;
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
  const stage = catStage(score);

  useEffect(() => {
    game.init();
  }, []);

  useEffect(() => {
    if (!playing || circle) return;
    const avoid = () => [inflate(catScope.current!.getBoundingClientRect(), 24)];
    const t = setTimeout(() => setCircle({ id: Date.now(), ...randomSpot(avoid()) }), nextDelay.current);
    const onResize = () => setCircle((c) => c && { ...c, ...randomSpot(avoid()) });
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [playing, circle, catScope]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  function togglePlay() {
    if (playing) setCircle(null);
    else {
      nextDelay.current = 350;
      if (score === 0) setToast({ id: Date.now(), text: CAT_STAGE_LINES[0] });
    }
    game.togglePlay();
  }

  function catchCircle(c: Circle) {
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
            key={circle.id}
            type="button"
            aria-label="Catch the circle"
            onClick={() => catchCircle(circle)}
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

        <div className="relative flex items-end gap-2">
          <AnimatePresence>
            {color && !playing && score === 0 && (
              <motion.span
                aria-hidden
                initial={reduce ? false : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0, transition: { delay: reduce ? 0 : 1.2, duration: 0.5, ease } }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                className="mb-3 rounded-full bg-surface px-3.5 py-2 text-xs font-semibold whitespace-nowrap text-ink shadow-tile ring-1 ring-ink/5"
              >
                Play with me
              </motion.span>
            )}
          </AnimatePresence>

          <motion.button
            ref={catScope}
            type="button"
            aria-label={playing ? "Pause the cat game" : "Start the cat game"}
            onClick={togglePlay}
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
