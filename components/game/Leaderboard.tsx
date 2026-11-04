"use client";

import { X } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_NAME, loadScores, saveScore, type ScoreEntry } from "@/lib/leaderboard";
import { game, useGame } from "./store";

const SHOWN = 10;
const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Score popover under the nav pill: save the current score and see the best local scores. */
export function Leaderboard({ onClose }: { onClose: () => void }) {
  const { score, playerName } = useGame();
  const reduce = useReducedMotion();
  const [scores, setScores] = useState<ScoreEntry[]>(loadScores);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<ScoreEntry | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close, not the input, gets focus so a tap on a phone does not pop the keyboard.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  const [message, setMessage] = useState("");

  function save(e: FormEvent) {
    e.preventDefault();
    if (score === 0) {
      setMessage("Score some points first. Tap the cat, then catch a circle.");
      return;
    }
    const finalName = name.trim() || playerName;
    const { entry, list } = saveScore(finalName, score);
    setScores(list);
    setSaved(entry);
    setMessage(`Saved ${entry.name} with ${score} points.`);
    setName("");
    game.newPlayerName();
  }

  return (
    <motion.div
      id="leaderboard"
      role="dialog"
      aria-labelledby="leaderboard-title"
      initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6 }}
      transition={{ duration: reduce ? 0 : 0.35, ease: [0.32, 0.72, 0, 1] }}
      className="pointer-events-auto fixed inset-x-4 top-20 origin-top-right rounded-tile bg-surface/80 p-1.5 shadow-tile ring-1 ring-ink/5 backdrop-blur-xl md:absolute md:inset-x-auto md:top-[calc(100%+0.875rem)] md:right-0 md:w-[22rem]"
    >
      <div className="rounded-[calc(1.5rem-0.375rem)] bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 id="leaderboard-title" className="text-lg font-bold tracking-tight text-ink">
            Leaderboard
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close leaderboard"
            onClick={onClose}
            className={`grid size-9 place-items-center rounded-full bg-ink/5 text-ink active:scale-95 ${focusRing}`}
          >
            <X weight="light" size={16} />
          </button>
        </div>

        <form onSubmit={save} className="mt-4 flex flex-col gap-2">
          <label htmlFor="leaderboard-name" className="text-sm font-medium text-mute">
            Your name
          </label>
          <div className="flex gap-2">
            <input
              id="leaderboard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME}
              autoComplete="nickname"
              placeholder={playerName ? `e.g. ${playerName}` : undefined}
              className="h-11 min-w-0 flex-1 rounded-full bg-ink/[0.04] px-4 text-sm text-ink ring-1 ring-ink/10 placeholder:text-mute focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            />
            <button
              type="submit"
              className={`h-11 shrink-0 rounded-full bg-accent-ink px-5 text-sm font-semibold whitespace-nowrap text-snow active:scale-[0.98] dark:text-night ${focusRing}`}
            >
              Save score
            </button>
          </div>
          <p aria-live="polite" className="min-h-5 text-sm text-mute">
            {message || (
              <>
                You have <span className="font-mono text-ink">{score}</span> {score === 1 ? "point" : "points"}.
              </>
            )}
          </p>
        </form>

        {scores.length === 0 ? (
          <p className="mt-3 rounded-[calc(1.5rem-0.375rem)] bg-ink/[0.03] px-4 py-5 text-center text-sm text-mute">
            No scores yet. Be the first!
          </p>
        ) : (
          <ol aria-label="Top scores" className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {scores.slice(0, SHOWN).map((s, i) => (
              <li
                key={`${s.date}-${i}`}
                className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm ${s === saved ? "bg-accent/15" : i < 3 ? "bg-ink/[0.03]" : ""}`}
              >
                <span className={`w-5 text-right font-mono ${i < 3 ? "font-semibold text-accent-ink" : "text-mute"}`}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
                <span className="font-mono text-ink tabular-nums">{s.score}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-mute">Scores are saved on this device.</p>
      </div>
    </motion.div>
  );
}
