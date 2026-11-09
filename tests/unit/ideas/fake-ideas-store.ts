import { costOf } from "@/lib/ai/claude";
import { ClaimLost, type IdeasJobStore } from "@/lib/ideas/store";
import type { IdeaReview, IdeaSettings, ReviewStatus, SavedIdea, SourceKind } from "@/lib/ideas/types";
import type { Comment, Item } from "@/lib/hub/types";

export type FakeSource = {
  itemId: string;
  kind: SourceKind;
  status: "pending" | "done" | "failed";
  ideas: SavedIdea[];
  attempts: number;
  model: string | null;
  lastError: string | null;
  claimed: boolean;
};

export type FakeIdeasRows = {
  items: Map<string, Item>;
  settings: Map<string, IdeaSettings>;
  reviews: { itemId: string; version: number; review: IdeaReview; model: string; costUsd: number; note: string | null }[];
  usage: { itemId: string; model: string; purpose: string; cost: number }[];
  flags: Map<string, unknown>;
  failedDetections: number;
  sources: Map<string, FakeSource>;
  comments: Comment[];
  mentions: Map<string, number>;
  moved: Set<string>;
};

let counter = 0;

export function ideaItem(overrides: Partial<Item> = {}): Item {
  const id = `00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;
  return {
    id,
    title: `idea ${counter}`,
    description: "",
    labels: ["idea"],
    list: "ideas",
    state: "open",
    due: null,
    mergedInto: null,
    source: "capture",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    url: `https://masonbair.com/hub/item/${id}`,
    ...overrides,
  };
}

/** An in-memory IdeasJobStore that records every call and throws on any method the real store does not have. */
export function createFakeIdeasStore() {
  const rows: FakeIdeasRows = {
    items: new Map(),
    settings: new Map(),
    reviews: [],
    usage: [],
    flags: new Map(),
    failedDetections: 0,
    sources: new Map(),
    comments: [],
    mentions: new Map(),
    moved: new Set(),
  };
  const calls: string[] = [];

  const setStatus = (from: ReviewStatus, to: ReviewStatus) => {
    let n = 0;
    for (const s of rows.settings.values()) {
      if (s.reviewStatus !== from) continue;
      s.reviewStatus = to;
      n += 1;
    }
    return n;
  };

  const impl: IdeasJobStore = {
    async claimReview() {
      const next = [...rows.settings.values()]
        .filter((s) => s.reviewStatus === "waiting")
        .sort((a, b) => (a.reviewRequestedAt ?? "~").localeCompare(b.reviewRequestedAt ?? "~"))[0];
      if (!next) return null;
      next.reviewStatus = "working";
      return next.itemId;
    },
    getIdea: async (id) => rows.items.get(id) ?? null,
    openIdeaTitles: async () =>
      [...rows.items.values()].filter((i) => i.list === "ideas" && i.state === "open").map((i) => ({ id: i.id, title: i.title })),
    settings: async (id) => {
      const s = rows.settings.get(id);
      return s ? { ...s } : null;
    },
    async saveReview(id, review, model, costUsd, note) {
      if (rows.settings.get(id)?.reviewStatus !== "working") throw new ClaimLost(id);
      const version = rows.reviews.filter((r) => r.itemId === id).length + 1;
      rows.reviews.push({ itemId: id, version, review, model, costUsd, note });
      Object.assign(rows.settings.get(id)!, { reviewStatus: "done", reviewAttempts: 0, lastError: null, reviewNote: null });
      return version;
    },
    async failReview(id, code) {
      const s = rows.settings.get(id)!;
      s.reviewAttempts += 1;
      s.reviewStatus = s.reviewAttempts >= 2 ? "failed" : "waiting";
      s.lastError = code;
      return s.reviewStatus;
    },
    async releaseClaim(id, status) {
      const s = rows.settings.get(id)!;
      if (s.reviewStatus === "working") s.reviewStatus = status;
    },
    pauseWaiting: async () => setStatus("waiting", "paused"),
    resumePaused: async () => setStatus("paused", "waiting"),
    async recordUsage(row) {
      const cost = costOf(row.model, row.usage);
      rows.usage.push({ itemId: row.itemId, model: row.model, purpose: row.purpose, cost });
      return cost;
    },
    failureCounts: async () => ({
      reviews: [...rows.settings.values()].filter((s) => s.reviewStatus === "failed").length,
      detections: rows.failedDetections,
    }),
    getFlag: async (key) => rows.flags.get(key) ?? null,
    async setFlag(key, value) {
      rows.flags.set(key, value);
    },
    async ideaQuote(id) {
      const entries = [...rows.sources.values()].flatMap((s) => s.ideas).filter((i) => i.outcome?.id === id);
      return (entries.find((i) => i.outcome?.kind !== "mention") ?? entries[0])?.quote ?? null;
    },
    async claimSource(kinds) {
      const next = [...rows.sources.values()].find((s) => s.status === "pending" && s.attempts < 3 && !s.claimed && kinds.includes(s.kind));
      if (!next) return null;
      next.claimed = true;
      next.attempts += 1;
      const saved = next.ideas.length ? { ideas: structuredClone(next.ideas), model: next.model as "claude-haiku-5-5" | null } : null;
      return { itemId: next.itemId, kind: next.kind, saved };
    },
    listComments: async (id) => rows.comments.filter((c) => c.itemId === id),
    async saveIdeas(id, ideas, model) {
      const source = rows.sources.get(id)!;
      if (source.status !== "pending" || !source.claimed) throw new ClaimLost(id);
      Object.assign(source, { ideas: structuredClone(ideas), model });
    },
    async finishSource(id, ideas, model) {
      const source = rows.sources.get(id)!;
      if (source.status !== "pending" || !source.claimed) throw new ClaimLost(id);
      Object.assign(source, { status: "done", ideas: structuredClone(ideas), model, claimed: false });
    },
    async failSource(id, code) {
      const source = rows.sources.get(id)!;
      source.status = source.attempts >= 3 ? "failed" : "pending";
      source.lastError = code;
      source.claimed = false;
      return source.status;
    },
    async releaseSource(id) {
      const source = rows.sources.get(id)!;
      source.attempts -= 1;
      source.claimed = false;
    },
    async moveCaptureToIdeas(id) {
      const item = rows.items.get(id)!;
      rows.items.set(id, { ...item, list: "ideas", labels: [...item.labels, "idea"] });
      rows.moved.add(id);
      seedSettings(id);
    },
    async addIdeaFrom(origin, n, title, quote) {
      const key = `idea:${origin.itemId}#${n}`;
      const existing = [...rows.items.values()].find((i) => i.description.endsWith(`key:${key}`));
      if (existing) return existing.id;
      const item = ideaItem({
        title,
        source: "ideas-lab",
        description: `> ${quote}\n\nSource: ${origin.url}, recorded ${origin.recorded}\nkey:${key}`,
      });
      rows.items.set(item.id, item);
      seedSettings(item.id);
      return item.id;
    },
    async mentionAgain(ideaId, sourceUrl, date, quote) {
      const body = `Mentioned again in ${sourceUrl} on ${date}\n\n> ${quote}`;
      if (rows.comments.some((c) => c.itemId === ideaId && c.body === body)) return;
      rows.comments.push({ id: `c${rows.comments.length}`, itemId: ideaId, body, author: "worker", createdAt: date });
      rows.mentions.set(ideaId, (rows.mentions.get(ideaId) ?? 1) + 1);
    },
  };

  function seedSettings(id: string) {
    if (rows.settings.has(id)) return;
    rows.settings.set(id, {
      itemId: id,
      enrolled: true,
      noWebSearch: false,
      reviewStatus: "waiting",
      reviewRequestedAt: "2026-11-09T12:00:00Z",
      reviewNote: null,
      reviewAttempts: 0,
      lastError: null,
    });
  }

  const store = new Proxy(impl, {
    get(target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (!(prop in target)) throw new Error(`fake ideas store: no method ${prop}`);
      const value = target[prop as keyof IdeasJobStore];
      return (...args: unknown[]) => {
        calls.push(prop);
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    },
  });

  function seed(item: Partial<Item> = {}, settings: Partial<IdeaSettings> = {}): Item {
    const seeded = ideaItem(item);
    rows.items.set(seeded.id, seeded);
    rows.settings.set(seeded.id, {
      itemId: seeded.id,
      enrolled: true,
      noWebSearch: false,
      reviewStatus: "waiting",
      reviewRequestedAt: `2026-11-01T00:00:${String(counter % 60).padStart(2, "0")}Z`,
      reviewNote: null,
      reviewAttempts: 0,
      lastError: null,
      ...settings,
    });
    return seeded;
  }

  /** An inbox item with a pending detection row, as the intake trigger (or the memo relay) leaves it. */
  function seedSource(item: Partial<Item> = {}, kind: SourceKind = "capture"): Item {
    const seeded = ideaItem({ labels: [], list: "inbox", ...item });
    rows.items.set(seeded.id, seeded);
    rows.sources.set(seeded.id, { itemId: seeded.id, kind, status: "pending", ideas: [], attempts: 0, model: null, lastError: null, claimed: false });
    return seeded;
  }

  return { store, rows, calls, seed, seedSource };
}
