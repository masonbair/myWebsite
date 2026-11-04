// Client-safe: no secrets here. Server validation and storage live in leaderboard-server.ts.
export type Entry = { name: string; score: number };
export type ScoreEntry = Entry & { date: string };

// Same key and shape as the old static site, so visitors keep their scores.
export const LEADERBOARD_KEY = "catGameLeaderboard";
export const MAX_NAME = 20;
export const MAX_SCORE = 1000;
export const RATE_LIMIT = { max: 5, windowMinutes: 10 };
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

const isShared = (e: unknown): e is Entry =>
  typeof e === "object" && e !== null && typeof (e as Entry).name === "string" && typeof (e as Entry).score === "number";

async function readEntries(res: Response): Promise<Entry[] | null> {
  const body: unknown = await res.json().catch(() => null);
  const entries = (body as { entries?: unknown } | null)?.entries;
  return Array.isArray(entries) ? entries.filter(isShared) : null;
}

/** The shared top scores, or null when the leaderboard can't be reached. */
export async function fetchSharedScores(signal?: AbortSignal): Promise<Entry[] | null> {
  try {
    const res = await fetch("/api/leaderboard", { signal, cache: "no-store" });
    return res.ok ? await readEntries(res) : null;
  } catch {
    return null;
  }
}

export type SubmitResult =
  | { kind: "saved"; entries: Entry[] }
  | { kind: "rejected"; message: string }
  | { kind: "offline" };

const REJECTED: Record<string, string> = {
  bad_name: "Names need 1 to 20 characters.",
  offensive_name: "That name isn't allowed. Try another one.",
  bad_score: "That score can't be saved.",
  rate_limited: "Too many scores from you. Try again in a few minutes.",
};

/** Posts a score to the shared board; "offline" means the caller should save locally. */
export async function submitSharedScore(entry: Entry): Promise<SubmitResult> {
  try {
    const res = await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (res.status === 400 || res.status === 429) {
      const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "";
      return { kind: "rejected", message: REJECTED[error] ?? REJECTED.bad_score };
    }
    const entries = res.ok ? await readEntries(res) : null;
    return entries ? { kind: "saved", entries } : { kind: "offline" };
  } catch {
    return { kind: "offline" };
  }
}
