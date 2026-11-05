import type { SupabaseClient } from "@supabase/supabase-js";
import { labelsForStatus } from "./lifecycle";
import {
  assertAllowed,
  assertArchiveAllowed,
  assertArchiveArgs,
  assertHubStateKey,
  assertLabelChangeAllowed,
  assertStateChange,
  assertStatusLabel,
  auditActor,
  pickPatch,
} from "./rules";
import type { Actor, Comment, HubAction, HubStore, Item, ItemPatch, ItemQuery } from "./types";

export const ITEM_URL_BASE = "https://masonbair.com/hub/item/";

const UNIQUE_VIOLATION = "23505";
const DEFAULT_LIMIT = 200;

type ItemRow = {
  id: string;
  title: string;
  description: string;
  labels: string[];
  list: Item["list"];
  state: Item["state"];
  due_date: string | null;
  due_time: string | null;
  merged_into: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

type CommentRow = {
  id: string;
  item_id: string;
  body: string;
  author: Comment["author"];
  created_at: string;
};

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    labels: row.labels,
    list: row.list,
    state: row.state,
    due: row.due_date ? { date: row.due_date, time: row.due_time } : null,
    mergedInto: row.merged_into,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: `${ITEM_URL_BASE}${row.id}`,
  };
}

function toComment(row: CommentRow): Comment {
  return { id: row.id, itemId: row.item_id, body: row.body, author: row.author, createdAt: row.created_at };
}

function toPatchColumns(rawPatch: ItemPatch): Record<string, unknown> {
  const patch = pickPatch(rawPatch);
  const columns: Record<string, unknown> = {};
  if (patch.title !== undefined) columns.title = patch.title;
  if (patch.description !== undefined) columns.description = patch.description;
  if (patch.labels !== undefined) columns.labels = patch.labels;
  if (patch.list !== undefined) columns.list = patch.list;
  if (patch.due !== undefined) {
    columns.due_date = patch.due?.date ?? null;
    columns.due_time = patch.due?.time ?? null;
  }
  return columns;
}

function quoteArrayLabel(label: string): string {
  return `"${label.replace(/["\\]/g, "\\$&")}"`;
}

export function createHubStore(client: SupabaseClient, actor: Actor): HubStore {
  async function audit(action: HubAction, itemId: string | null, detail: Record<string, unknown> = {}) {
    if (actor.kind === "mason") return;
    const { error } = await client
      .from("audit_log")
      .insert({ actor: auditActor(actor), action, item_id: itemId, detail });
    if (error) throw error;
  }

  async function fetchItem(id: string): Promise<Item | null> {
    const { data, error } = await client.from("items").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toItem(data as ItemRow) : null;
  }

  async function requireItem(id: string): Promise<Item> {
    const item = await fetchItem(id);
    if (!item) throw new Error(`no item ${id}`);
    return item;
  }

  async function updateColumns(id: string, columns: Record<string, unknown>): Promise<Item> {
    const { data, error } = await client.from("items").update(columns).eq("id", id).select("*").single();
    if (error) throw error;
    return toItem(data as ItemRow);
  }

  async function insertComment(itemId: string, body: string): Promise<Comment> {
    const { data, error } = await client
      .from("comments")
      .insert({ item_id: itemId, body, author: actor.kind })
      .select("*")
      .single();
    if (error) throw error;
    return toComment(data as CommentRow);
  }

  async function itemByClientKey(clientKey: string): Promise<Item | null> {
    const { data, error } = await client.from("items").select("*").eq("client_key", clientKey).maybeSingle();
    if (error) throw error;
    return data ? toItem(data as ItemRow) : null;
  }

  return {
    async getItem(id) {
      assertAllowed(actor, "read");
      return fetchItem(id);
    },

    async listItems(q: ItemQuery) {
      assertAllowed(actor, "read");
      let query = client.from("items").select("*");
      if (q.list) query = query.eq("list", q.list);
      if (q.state) query = query.eq("state", q.state);
      if (q.withLabels?.length) query = query.contains("labels", q.withLabels);
      for (const label of q.withoutLabels ?? []) {
        query = query.not("labels", "cs", `{${quoteArrayLabel(label)}}`);
      }
      if (q.updatedBefore) query = query.lt("updated_at", q.updatedBefore);
      if (q.mergedInto) query = query.eq("merged_into", q.mergedInto);
      if (q.hasDue) query = query.not("due_date", "is", null);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(q.limit ?? DEFAULT_LIMIT);
      if (error) throw error;
      return (data as ItemRow[]).map(toItem);
    },

    async addItem(input) {
      assertAllowed(actor, "add");
      assertLabelChangeAllowed(actor, [], input.labels ?? []);
      if (input.clientKey) {
        const existing = await itemByClientKey(input.clientKey);
        if (existing) return existing;
      }
      const { data, error } = await client
        .from("items")
        .insert({
          title: input.title,
          description: input.description ?? "",
          labels: input.labels ?? [],
          list: input.list ?? "inbox",
          due_date: input.due?.date ?? null,
          due_time: input.due?.time ?? null,
          source: input.source,
          client_key: input.clientKey ?? null,
        })
        .select("*")
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION && input.clientKey) {
          const winner = await itemByClientKey(input.clientKey);
          if (winner) return winner;
        }
        throw error;
      }
      const item = toItem(data as ItemRow);
      await audit("add", item.id, { source: input.source });
      return item;
    },

    async updateItem(id, patch) {
      assertAllowed(actor, "update");
      if (patch.labels) {
        const current = await requireItem(id);
        assertLabelChangeAllowed(actor, current.labels, patch.labels);
      }
      const item = await updateColumns(id, toPatchColumns(patch));
      await audit("update", id, { fields: Object.keys(patch) });
      return item;
    },

    async complete(id) {
      assertAllowed(actor, "complete");
      assertStateChange((await requireItem(id)).state, "done");
      return updateColumns(id, { state: "done" });
    },

    async reopen(id) {
      assertAllowed(actor, "reopen");
      assertStateChange((await requireItem(id)).state, "open");
      return updateColumns(id, { state: "open" });
    },

    async archive(id, reason, mergedInto, note) {
      assertAllowed(actor, "archive");
      assertArchiveArgs(reason, mergedInto, id);
      const current = await requireItem(id);
      assertArchiveAllowed(actor, current.state, note);
      await insertComment(id, note);
      const item = await updateColumns(id, {
        state: "archived",
        archived_reason: reason,
        merged_into: mergedInto,
      });
      await audit("archive", id, { reason, mergedInto });
      return item;
    },

    async claim(id) {
      assertAllowed(actor, "claim");
      const { data, error } = await client.rpc("hub_claim", { p_item: id });
      if (error) throw error;
      const claimed = data === true;
      await audit("claim", id, { claimed });
      return claimed;
    },

    async setStatusLabels(id, status) {
      assertAllowed(actor, "set-status-labels");
      assertStatusLabel(status);
      const current = await requireItem(id);
      await updateColumns(id, { labels: labelsForStatus(status, current.labels) });
      await audit("set-status-labels", id, { status });
    },

    async addComment(itemId, body) {
      assertAllowed(actor, "comment");
      const comment = await insertComment(itemId, body);
      await audit("comment", itemId);
      return comment;
    },

    async listComments(itemId) {
      assertAllowed(actor, "read");
      const { data, error } = await client
        .from("comments")
        .select("*")
        .eq("item_id", itemId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as CommentRow[]).map(toComment);
    },

    async getHubState(key) {
      assertAllowed(actor, "hub-state");
      const { data, error } = await client.from("hub_state").select("value").eq("key", key).maybeSingle();
      if (error) throw error;
      return data ? data.value : null;
    },

    async setHubState(key, value) {
      assertAllowed(actor, "hub-state");
      assertHubStateKey(key);
      const { error } = await client
        .from("hub_state")
        .upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) throw error;
      await audit("update", null, { hubState: key });
    },
  };
}

