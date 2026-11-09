"use client";

import { X } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_NAME,
  fetchSharedScores,
  loadScores,
  saveScore,
  submitSharedScore,
  type Entry,
} from "@/lib/leaderboard";
import { game, useGame } from "./store";

const SHOWN = 10;
const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
const OFFLINE = "Couldn't reach the leaderboard. Saved on this device.";
const FOOTER = { loading: "", shared: "Scores are shared with everyone.", local: "Scores are saved on this device." };

/** Score popover under the nav pill: save the current score and see the shared top scores, or local ones offline. */
export function Leaderboard({ onClose }: { onClose: () => void }) {
  const { score, playerName } = useGame();
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<keyof typeof FOOTER>("loading");
  const [scores, setScores] = useState<Entry[]>([]);
  const [name, setName] = useState("");
  const [savedAt, setSavedAt] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close, not the input, gets focus so a tap on a phone does not pop the keyboard.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSharedScores(ctrl.signal).then((entries) => {
      if (ctrl.signal.aborted) return;
      setScores(entries ?? loadScores());
      setMode(entries ? "shared" : "local");
    });
    return () => ctrl.abort();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (score === 0) {
      setMessage("Score some points first. Tap the cat, then catch a circle.");
      return;
    }
    const finalName = [...(name.trim() || playerName).replace(/\s+/g, " ")].slice(0, MAX_NAME).join("").trim();
    setSaving(true);
    const result = await submitSharedScore({ name: finalName, score });
    setSaving(false);
    if (result.kind === "rejected") {
      setMessage(result.message);
      return;
    }
    if (result.kind === "saved") {
      setScores(result.entries);
      setMode("shared");
      setSavedAt(result.entries.findIndex((s) => s.name === finalName && s.score === score));
      setMessage(`Saved ${finalName} with ${score} points.`);
    } else {
      const { entry, list } = saveScore(finalName, score);
      setScores(list);
      setMode("local");
      setSavedAt(list.indexOf(entry));
      setMessage(OFFLINE);
    }
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
      className="pointer-events-auto fixed inset-x-4 top-20 origin-top-right rounded-tile border-[2.5px] border-line bg-surface p-1.5 shadow-tile md:absolute md:inset-x-auto md:top-[calc(100%+0.875rem)] md:right-0 md:w-[22rem]"
    >
      <div className="p-5">
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
              className="h-11 min-w-0 flex-1 rounded-full border-2 border-line bg-canvas px-4 text-sm text-ink placeholder:text-mute focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            />
            <button
              type="submit"
              disabled={saving}
              className={`h-11 shrink-0 rounded-full bg-accent-ink px-5 text-sm font-semibold whitespace-nowrap text-snow active:scale-[0.98] disabled:opacity-60 dark:text-night ${focusRing}`}
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

        {mode === "loading" ? (
          <p role="status" className="mt-3 rounded-[calc(1.5rem-0.375rem)] bg-ink/[0.03] px-4 py-5 text-center text-sm text-mute">
            Loading scores…
          </p>
        ) : scores.length === 0 ? (
          <p className="mt-3 rounded-[calc(1.5rem-0.375rem)] bg-ink/[0.03] px-4 py-5 text-center text-sm text-mute">
            No scores yet. Be the first!
          </p>
        ) : (
          <ol aria-label="Top scores" className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {scores.slice(0, SHOWN).map((s, i) => (
              <li
                key={`${i}-${s.name}-${s.score}`}
                className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm ${i === savedAt ? "bg-accent/15" : i < 3 ? "bg-ink/[0.03]" : ""}`}
              >
                <span className={`w-5 text-right font-mono ${i < 3 ? "font-semibold text-accent-ink" : "text-mute"}`}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
                <span className="font-mono text-ink tabular-nums">{s.score}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 min-h-4 text-xs text-mute">{FOOTER[mode]}</p>
      </div>
    </motion.div>
  );
}
