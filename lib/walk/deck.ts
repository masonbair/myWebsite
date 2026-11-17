import { z } from "zod";

export type WalkCard = { prompt: string; from: string | null };

export const STARTER_COUNT = 8;
export const MAX_MEMO_CARDS = 4;

// Easy to start talking about out loud; any of them is a fine first topic.
export const STARTERS: string[] = [
  "What annoyed you at least three times this week?",
  "What did you spend money on lately that felt dumb?",
  "What's something you do by hand that a small app could do for you?",
  "Pick the last place you stayed. What would have made it better?",
  "What would a friend pay you to just do for them?",
  "What did you look up on your phone today, and why?",
  "Describe your perfect working day on the road. What's missing from it now?",
  "What's a tool you love? What would the weird version of it be?",
  "What's something you baked that went wrong? What would have caught it?",
  "Who did you talk to this week? What were they stuck on?",
  "What do you keep meaning to track but never do?",
  "What's a game you could make in a weekend?",
  "What would your website do if it could do anything at all?",
  "What's a habit you want? What would nudge you into it?",
  "What do travelers ask each other about all the time?",
  "What would you build if it had to be done by tonight?",
  "What's the most boring part of building with Claude? Could it be fun?",
  "What do you wish your phone did when you walk into a new city?",
  "Think of something you're good at. How could it teach someone else?",
  "What's an idea you dropped? Why did you drop it, and was that right?",
  "What would make a coffee chat with a stranger great?",
  "What's something you check every day? What would make it faster?",
  "What's a small thing that would make your friends laugh?",
  "If you had to sell something this month, what would it be?",
];

export const memoCardsSchema = z.object({
  cards: z
    .array(
      z.object({
        prompt: z.string().min(1).max(200),
        from: z.string().min(1).max(80),
      }),
    )
    .max(MAX_MEMO_CARDS),
});

/** Claude's or the cache's memo cards, or an empty list when the value does not fit the schema. */
export function parseMemoCards(raw: unknown): WalkCard[] {
  const parsed = memoCardsSchema.safeParse(raw);
  return parsed.success ? parsed.data.cards : [];
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shuffled deck of random starters plus the memo cards, with a memo card first when there is one. */
export function buildDeck(memoCards: WalkCard[], random: () => number = Math.random): WalkCard[] {
  const starters = shuffle(STARTERS, random)
    .slice(0, STARTER_COUNT)
    .map((prompt) => ({ prompt, from: null }));
  const [first, ...rest] = shuffle(memoCards.slice(0, MAX_MEMO_CARDS), random);
  const mixed = shuffle([...rest, ...starters], random);
  return first ? [first, ...mixed] : mixed;
}
