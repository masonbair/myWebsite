export type ScoreEntry = { name: string; score: number; date: string };

// Same key and shape as the old static site, so visitors keep their scores.
export const LEADERBOARD_KEY = "catGameLeaderboard";
export const MAX_NAME = 20;
const MAX_ENTRIES = 50;

const isEntry = (e: unknown): e is ScoreEntry =>
  typeof e === "object" &&
  e !== null &&
  typeof (e as ScoreEntry).name === "string" &&
  typeof (e as ScoreEntry).score === "number" &&
  typeof (e as ScoreEntry).date === "string";

/** Saved scores, best first; empty when storage is blocked or corrupt. */
export function loadScores(): ScoreEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry).sort((a, b) => b.score - a.score) : [];
  } catch {
    return [];
  }
}

/** Adds a score and returns the new entry plus the new list, even when it could not be stored. */
export function saveScore(name: string, score: number): { entry: ScoreEntry; list: ScoreEntry[] } {
  const entry = { name: name.trim().slice(0, MAX_NAME), score, date: new Date().toISOString() };
  const list = [...loadScores(), entry].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
  } catch {}
  return { entry, list };
}
