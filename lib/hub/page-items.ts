import type { HubStore, Item, ItemQuery } from "./types";

/** Far above Mason's open items today; a page past it says how many it left out instead of cutting silently. */
export const OWNER_PAGE_LIMIT = 2000;

export type PageItems = { items: Item[]; total: number };

/** Up to `limit` matching items plus how many match in all; the count query runs only when the list was cut. */
export async function listForPage(store: HubStore, q: Omit<ItemQuery, "limit">, limit = OWNER_PAGE_LIMIT): Promise<PageItems> {
  const items = await store.listItems({ ...q, limit });
  const total = items.length < limit ? items.length : await store.countItems(q);
  return { items, total };
}
