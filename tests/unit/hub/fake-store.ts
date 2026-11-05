import {
  assertAllowed,
  assertArchiveAllowed,
  assertArchiveArgs,
  assertHubStateKey,
  assertLabelChangeAllowed,
  assertStateChange,
  assertStatusLabel,
  pickPatch,
} from "@/lib/hub/rules";
import { claimLabels, isClaimable, labelsForStatus } from "@/lib/hub/lifecycle";
import { ITEM_URL_BASE } from "@/lib/hub/store";
import type { Actor, ArchiveReason, Comment, HubStore, Item } from "@/lib/hub/types";

type Rows = {
  items: Map<string, Item>;
  clientKeys: Map<string, string>;
  comments: Comment[];
  state: Map<string, unknown>;
  archivedReasons: Map<string, ArchiveReason>;
  /** File name to memo item id; null for a seeded file. */
  memoFiles: Map<string, string | null>;
};

export type FakeStore = HubStore & { rows: Rows };

/** @param now stands in for the database clock that hub_claim checks staleness against. */
export function createFakeStore(actor: Actor, rows?: Rows, now: () => Date = () => new Date()): FakeStore {
  const data: Rows = rows ?? {
    items: new Map(),
    clientKeys: new Map(),
    comments: [],
    state: new Map(),
    archivedReasons: new Map(),
    memoFiles: new Map(),
  };
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
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((i) => (q.list ? i.list === q.list : true))
        .filter((i) => (q.state ? i.state === q.state : true))
        .filter((i) => (q.withLabels ?? []).every((l) => i.labels.includes(l)))
        .filter((i) => (q.withoutLabels ?? []).every((l) => !i.labels.includes(l)))
        .filter((i) => (q.updatedBefore ? i.updatedAt < q.updatedBefore : true))
        .filter((i) => (q.mergedInto ? i.mergedInto === q.mergedInto : true))
        .filter((i) => (q.hasDue ? i.due !== null : true))
        .filter((i) => (q.clientKey ? data.clientKeys.get(q.clientKey) === i.id : true))
        .filter((i) => (q.text ? `${i.title}\n${i.description}`.toLowerCase().includes(q.text.toLowerCase()) : true))
        .slice(0, q.limit ?? 200);
    },
    async addItem(input) {
      assertAllowed(actor, "add");
      assertLabelChangeAllowed(actor, [], input.labels ?? []);
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
      return save(item, pickPatch(patch));
    },
    async complete(id) {
      assertAllowed(actor, "complete");
      assertStateChange(need(id).state, "done");
      return save(need(id), { state: "done" });
    },
    async reopen(id) {
      assertAllowed(actor, "reopen");
      assertStateChange(need(id).state, "open");
      return save(need(id), { state: "open" });
    },
    async archive(id, reason, mergedInto, note) {
      assertAllowed(actor, "archive");
      assertArchiveArgs(reason, mergedInto, id);
      const current = need(id);
      assertArchiveAllowed(actor, current.state, note);
      const archived = save(current, { state: "archived", mergedInto });
      data.archivedReasons.set(id, reason);
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
      if (!isClaimable(item, now())) return false;
      save(item, { labels: claimLabels(item.labels) });
      return true;
    },
    async setStatusLabels(id, status) {
      assertAllowed(actor, "set-status-labels");
      assertStatusLabel(status);
      const item = need(id);
      save(item, { labels: labelsForStatus(status, item.labels) });
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
      assertAllowed(actor, "hub-state");
      return data.state.has(key) ? data.state.get(key) : null;
    },
    async setHubState(key, value) {
      assertAllowed(actor, "hub-state");
      assertHubStateKey(key);
      data.state.set(key, value);
    },
    async acceptMemo(memo) {
      assertAllowed(actor, "memo-files");
      if (data.memoFiles.has(memo.file)) return { id: data.memoFiles.get(memo.file)!, duplicate: true };
      const item = await this.addItem({
        title: memo.title,
        description: memo.description,
        labels: ["hidock-memo"],
        source: `memo:${memo.device}`,
      });
      for (const body of memo.transcriptParts) await this.addComment(item.id, body);
      data.memoFiles.set(memo.file, item.id);
      return { id: item.id, duplicate: false };
    },
    async seedMemoFiles(files) {
      assertAllowed(actor, "memo-files");
      const unique = [...new Set(files)];
      const fresh = unique.filter((file) => !data.memoFiles.has(file));
      for (const file of fresh) data.memoFiles.set(file, null);
      return { seeded: fresh.length, known: unique.length - fresh.length };
    },
  };
}
