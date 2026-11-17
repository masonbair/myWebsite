import { describe, expect, it } from "vitest";
import { assertHubStateKey } from "@/lib/hub/rules";
import { buildDeck, MAX_MEMO_CARDS, parseMemoCards, STARTER_COUNT, STARTERS } from "@/lib/walk/deck";

const memo = (n: number) => Array.from({ length: n }, (_, i) => ({ prompt: `memo ${i}`, from: `note ${i}` }));

describe("buildDeck", () => {
  it("is only starters when there are no memo cards", () => {
    const deck = buildDeck([]);
    expect(deck).toHaveLength(STARTER_COUNT);
    expect(deck.every((c) => c.from === null && STARTERS.includes(c.prompt))).toBe(true);
    expect(new Set(deck.map((c) => c.prompt)).size).toBe(STARTER_COUNT);
  });

  it("leads with a memo card and keeps at most the memo limit", () => {
    const deck = buildDeck(memo(MAX_MEMO_CARDS + 3));
    expect(deck).toHaveLength(STARTER_COUNT + MAX_MEMO_CARDS);
    expect(deck[0].from).not.toBeNull();
    expect(deck.filter((c) => c.from !== null)).toHaveLength(MAX_MEMO_CARDS);
  });
});

describe("parseMemoCards", () => {
  it("keeps valid cards", () => {
    expect(parseMemoCards({ cards: memo(2) })).toEqual(memo(2));
  });

  it("gives an empty list for anything off-schema", () => {
    expect(parseMemoCards(null)).toEqual([]);
    expect(parseMemoCards({ cards: [{ prompt: "" , from: "x" }] })).toEqual([]);
    expect(parseMemoCards({ cards: memo(MAX_MEMO_CARDS + 1) })).toEqual([]);
  });
});

describe("walk-deck hub state key", () => {
  it("allows one key per day and nothing else", () => {
    expect(() => assertHubStateKey("walk-deck:2026-11-17")).not.toThrow();
    expect(() => assertHubStateKey("walk-deck:today")).toThrow();
  });
});
