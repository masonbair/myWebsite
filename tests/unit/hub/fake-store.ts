import {
  assertAllowed,
  assertArchiveArgs,
  assertLabelChangeAllowed,
  assertStatusLabels,
  STATUS_LABELS,
  CLAUDE_LABEL,
} from "@/lib/hub/rules";
import { ITEM_URL_BASE } from "@/lib/hub/store";
import type { Actor, Comment, HubStore, Item } from "@/lib/hub/types";

type Rows = {
  items: Map<string, Item>;
  clientKeys: Map<string, string>;
  comments: Comment[];
  state: Map<string, unknown>;
};

export type FakeStore = HubStore & { rows: Rows };

export function createFakeStore(actor: Actor, rows?: Rows): FakeStore {
  const data: Rows = rows ?? { items: new Map(), clientKeys: new Map(), comments: [], state: new Map() };
  let counter = data.items.size + data.comments.length;
  const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

  function need(id: string): Item {
    const item = data.items.get(id);
    if (!item) throw new Error(`no item ${id}`);
    return item;
  }

  function save(item: Item, changes: Partial<Item>): Item {
    const next = { ...item, ...changes, updatedAt: new Date().toISOString() };
    data.items.set(item.id, next);
    return next;
  }

  return {
    rows: data,
    async getItem(id) {
      assertAllowed(actor, "read");
      return data.items.get(id) ?? null;
    },
    async listItems(q) {
      assertAllowed(actor, "read");
      return [...data.items.values()]
        .filter((i) => (q.list ? i.list === q.list : true))
        .filter((i) => (q.state ? i.state === q.state : true))
        .filter((i) => (q.withLabels ?? []).every((l) => i.labels.includes(l)))
        .filter((i) => (q.withoutLabels ?? []).every((l) => !i.labels.includes(l)))
        .filter((i) => (q.updatedBefore ? i.updatedAt < q.updatedBefore : true))
        .slice(0, q.limit ?? 100);
    },
    async addItem(input) {
      assertAllowed(actor, "add");
      if (input.clientKey) {
        const existing = data.clientKeys.get(input.clientKey);
        if (existing) return need(existing);
      }
      const id = nextId();
      const now = new Date().toISOString();
      const item: Item = {
        id,
        title: input.title,
        description: input.description ?? "",
        labels: input.labels ?? [],
        list: input.list ?? "inbox",
        state: "open",
        due: input.due ?? null,
        mergedInto: null,
        source: input.source,
        createdAt: now,
        updatedAt: now,
        url: `${ITEM_URL_BASE}${id}`,
      };
      data.items.set(id, item);
      if (input.clientKey) data.clientKeys.set(input.clientKey, id);
      return item;
    },
    async updateItem(id, patch) {
      assertAllowed(actor, "update");
      const item = need(id);
      if (patch.labels) assertLabelChangeAllowed(actor, item.labels, patch.labels);
      return save(item, patch);
    },
    async complete(id) {
      assertAllowed(actor, "complete");
      return save(need(id), { state: "done" });
    },
    async reopen(id) {
      assertAllowed(actor, "reopen");
      return save(need(id), { state: "open" });
    },
    async archive(id, reason, mergedInto, note) {
      assertAllowed(actor, "archive");
      assertArchiveArgs(reason, mergedInto, id);
      const archived = save(need(id), { state: "archived", mergedInto });
      data.comments.push({
        id: nextId(),
        itemId: id,
        body: note,
        author: actor.kind,
        createdAt: new Date().toISOString(),
      });
      return archived;
    },
    async claim(id) {
      assertAllowed(actor, "claim");
      const item = need(id);
      if (!item.labels.includes(CLAUDE_LABEL) || item.labels.includes("claude-working")) return false;
      const others = item.labels.filter((l) => !(STATUS_LABELS as readonly string[]).includes(l));
      save(item, { labels: [...others, "claude-working"] });
      return true;
    },
    async setStatusLabels(id, labels) {
      assertAllowed(actor, "set-status-labels");
      assertStatusLabels(labels);
      const item = need(id);
      const others = item.labels.filter((l) => !(STATUS_LABELS as readonly string[]).includes(l));
      save(item, { labels: [...others, ...labels] });
    },
    async addComment(itemId, body) {
      assertAllowed(actor, "comment");
      need(itemId);
      const comment: Comment = {
        id: nextId(),
        itemId,
        body,
        author: actor.kind,
        createdAt: new Date().toISOString(),
      };
      data.comments.push(comment);
      return comment;
    },
    async listComments(itemId) {
      assertAllowed(actor, "read");
      return data.comments.filter((c) => c.itemId === itemId);
    },
    async getHubState(key) {
      assertAllowed(actor, "read");
      return data.state.has(key) ? data.state.get(key) : null;
    },
    async setHubState(key, value) {
      assertAllowed(actor, "update");
      data.state.set(key, value);
    },
  };
}
