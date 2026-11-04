/** Stage 0..10 for a score: one new feature every 2 points. */
export function catStage(score: number): number {
  return Math.max(0, Math.min(10, Math.floor(score / 2)));
}

/** Toast line shown on reaching each stage, ported from the old site's cat titles. */
export const CAT_STAGE_LINES: readonly string[] = [
  "Meow! Click the circles to help me grow! 🐱",
  "I have ears now! Keep clicking!",
  "I can see you now! 👀",
  "I can smell those circles! 🐱",
  "Look at my whiskers! 😸",
  "I have a tail now! 🐾",
  "Look at my beautiful spots! ✨",
  "I'm the king/queen of cats! 👑",
  "I can fly now! I'm a magical cat! 🦋",
  "I'm sparkling with magic! ✨🌟",
  "I'm the ultimate rainbow cat! 🌈😻 Maximum evolution reached!",
];

// Brand hues plus soft neutrals; each reads on both the light and dark canvas.
const CAT_COLORS = ["#8783d1", "#aa9aba", "#d1abad", "#a5a2b3", "#7d7a92", "#cdb9a5", "#d9a77c"] as const;

const ADJECTIVES = ["Swift", "Mighty", "Clever", "Brave", "Silent", "Golden", "Epic", "Cosmic", "Cyber", "Mystic", "Thunder", "Shadow", "Frost", "Blaze", "Storm", "Stellar", "Quantum", "Neon", "Turbo", "Ultra"];
const NOUNS = ["Cat", "Tiger", "Dragon", "Phoenix", "Ninja", "Knight", "Wizard", "Hunter", "Warrior", "Legend", "Hero", "Champion", "Master", "Ace", "Star", "Coder", "Hacker", "Gamer", "Pro", "Boss"];

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export const randomCatColor = () => pick(CAT_COLORS);

export const randomPlayerName = () => `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(Math.random() * 999) + 1}`;
