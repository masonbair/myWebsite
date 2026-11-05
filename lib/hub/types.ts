export type Actor =
  | { kind: "mason" }
  | { kind: "worker"; runId: string }
  | { kind: "agent"; client: string };

export type Item = {
  id: string;
  title: string;
  description: string;
  labels: string[];
  list: "inbox" | "todo" | "ideas";
  state: "open" | "done" | "archived";
  due: { date: string; time: string | null } | null;
  mergedInto: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type Comment = {
  id: string;
  itemId: string;
  body: string;
  author: Actor["kind"];
  createdAt: string;
};

export type ItemQuery = {
  list?: Item["list"];
  state?: Item["state"];
  withLabels?: string[];
  withoutLabels?: string[];
  updatedBefore?: string;
  mergedInto?: string;
  hasDue?: boolean;
  limit?: number;
};

export type NewItem = {
  title: string;
  description?: string;
  labels?: string[];
  list?: Item["list"];
  due?: Item["due"];
  source: string;
  clientKey?: string;
};

export type ItemPatch = Partial<Pick<Item, "title" | "description" | "labels" | "list" | "due">>;

export type HubAction =
  | "read"
  | "add"
  | "update"
  | "comment"
  | "complete"
  | "reopen"
  | "archive"
  | "claim"
  | "set-status-labels"
  | "hub-state"
  | "memo-files";

export type StatusLabel = "claude-working" | "claude-done" | "claude-question";

export type ArchiveReason = "merged" | "memo-split";

/** A HiDock memo ready to file: the item text plus the transcript already cut into comment parts. */
export type NewMemo = {
  file: string;
  recorded: string;
  device: "phone" | "mac";
  title: string;
  description: string;
  transcriptParts: string[];
};

/** `id` is null for a file seeded as already filed before the hub existed. */
export type AcceptedMemo = { id: string | null; duplicate: boolean };

export interface HubStore {
  getItem(id: string): Promise<Item | null>;
  listItems(q: ItemQuery): Promise<Item[]>;
  addItem(i: NewItem): Promise<Item>;
  updateItem(id: string, p: ItemPatch): Promise<Item>;
  complete(id: string): Promise<Item>;
  reopen(id: string): Promise<Item>;
  archive(id: string, reason: ArchiveReason, mergedInto: string | null, note: string): Promise<Item>;
  claim(id: string): Promise<boolean>;
  /** Moves an item to one claude status the way todo-hub did: done and question also drop `claude`. */
  setStatusLabels(id: string, status: StatusLabel): Promise<void>;
  addComment(itemId: string, body: string): Promise<Comment>;
  listComments(itemId: string): Promise<Comment[]>;
  getHubState(key: string): Promise<unknown | null>;
  setHubState(key: string, value: unknown): Promise<void>;
  /** Files the memo item, its transcript comments and its memo_files row together, once per file name. */
  acceptMemo(memo: NewMemo): Promise<AcceptedMemo>;
  /** Marks file names as already filed so an upload of them makes no item. */
  seedMemoFiles(files: string[]): Promise<{ seeded: number; known: number }>;
}
