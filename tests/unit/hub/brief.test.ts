import { describe, expect, it } from "vitest";
import { itemBrief } from "@/lib/hub/brief";
import type { Comment, Item } from "@/lib/hub/types";

const item: Item = {
  id: "6f1c2a52-6a39-4c55-9a2e-1b2a3c4d5e6f",
  title: "Build a notification system",
  description: "Push to my phone.\n",
  labels: ["hidock", "todo-hub"],
  list: "todo",
  state: "open",
  due: { date: "2026-11-24", time: null },
  mergedInto: null,
  source: "hidock",
  createdAt: "2026-11-18T10:00:00Z",
  updatedAt: "2026-11-18T10:00:00Z",
  url: "https://masonbair.com/hub/item/6f1c2a52-6a39-4c55-9a2e-1b2a3c4d5e6f",
};

const comment = (author: Comment["author"], body: string, createdAt: string): Comment => ({
  id: createdAt,
  itemId: item.id,
  body,
  author,
  createdAt,
});

describe("itemBrief", () => {
  it("includes the details, facts and every comment with who wrote it", () => {
    const text = itemBrief(
      item,
      [comment("worker", "Use web push.", "2026-11-18T17:00:00Z"), comment("mason", "Android first.", "2026-11-19T01:30:00Z")],
      "UTC",
    );
    expect(text).toBe(`# Task: Build a notification system

- List: Todo
- Due Tue, Nov 24
- Labels: hidock, todo-hub
- Hub item: ${item.url} (id ${item.id})

## Details

Push to my phone.

## Comments (oldest first)

### Hub worker (AI), 2026-11-18 17:00 UTC

Use web push.

### Mason, 2026-11-19 01:30 UTC

Android first.
`);
  });

  it("leaves out empty sections", () => {
    const text = itemBrief({ ...item, description: " ", labels: [], due: null, list: "inbox" }, [], "UTC");
    expect(text).toBe(`# Task: Build a notification system\n\n- List: Inbox\n- Hub item: ${item.url} (id ${item.id})\n`);
  });
});
