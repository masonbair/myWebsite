import { ItemSection } from "@/components/hub/ItemRow";
import { requireOwner } from "@/lib/auth/require-owner";
import { masonStore } from "@/lib/hub/mason-store";
import type { Item } from "@/lib/hub/types";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requireOwner();
  const store = await masonStore();
  const [inbox, questions, finished] = await Promise.all([
    store.listItems({ list: "inbox", state: "open" }),
    store.listItems({ state: "open", withLabels: ["claude-question"] }),
    store.listItems({ state: "open", withLabels: ["claude-done"] }),
  ]);
  const needsYou = [...new Map([...questions, ...finished].map((item) => [item.id, item])).values()].sort(
    (a: Item, b: Item) => b.updatedAt.localeCompare(a.updatedAt),
  );
  // An inbox item Claude is waiting on shows once, under "Needs you".
  const waiting = new Set(needsYou.map((item) => item.id));
  const unsorted = inbox.filter((item) => !waiting.has(item.id));

  return (
    <main>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight">Inbox</h1>
      <ItemSection id="unsorted" title="Unsorted" items={unsorted} empty="Nothing to sort." />
      <ItemSection id="needs-you" title="Needs you" items={needsYou} empty="Nothing is waiting on you." showList />
    </main>
  );
}
