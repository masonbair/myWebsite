import { costOf } from "@/lib/ai/claude";
import type { IdeasJobStore } from "@/lib/ideas/store";
import type { IdeaReview, IdeaSettings, ReviewStatus } from "@/lib/ideas/types";
import type { Item } from "@/lib/hub/types";

export type FakeIdeasRows = {
  items: Map<string, Item>;
  settings: Map<string, IdeaSettings>;
  reviews: { itemId: string; version: number; review: IdeaReview; model: string; costUsd: number; note: string | null }[];
  usage: { itemId: string; model: string; purpose: string; cost: number }[];
  flags: Map<string, unknown>;
  failedDetections: number;
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
  };

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

  return { store, rows, calls, seed };
}
