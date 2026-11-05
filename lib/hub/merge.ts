import { assertArchiveArgs, ItemNotOpenError } from "./rules";
import type { HubStore, Item } from "./types";

/** Archives `newer` into `older` with the note on the survivor; a retry after any step adds nothing twice. */
export async function mergeDuplicate(store: HubStore, newer: Item, older: Item, note: string): Promise<Item> {
  assertArchiveArgs("merged", older.id, newer.id);
  if (newer.state === "archived" && newer.mergedInto === older.id) return newer;
  if (newer.state !== "open") throw new ItemNotOpenError(newer);
  if (older.state === "archived") throw new ItemNotOpenError(older);
  const trimmed = note.trim();
  // The note lands on the survivor first, so a crash before the archive leaves both items open.
  const last = (await store.listComments(older.id)).at(-1);
  if (last?.body.trim() !== trimmed) await store.addComment(older.id, trimmed);
  return store.archive(newer.id, "merged", older.id, `merged into ${older.url}`);
}
