import { ItemSection } from "@/components/hub/ItemRow";
import { requireOwner } from "@/lib/auth/require-owner";
import { masonStore } from "@/lib/hub/mason-store";
import { listForPage } from "@/lib/hub/page-items";
import type { Item } from "@/lib/hub/types";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requireOwner();
  const store = await masonStore();
  const [inbox, questions, finished] = await Promise.all([
    listForPage(store, { list: "inbox", state: "open" }),
    listForPage(store, { state: "open", withLabels: ["claude-question"] }),
    listForPage(store, { state: "open", withLabels: ["claude-done"] }),
  ]);
  const needsYou = [...new Map([...questions.items, ...finished.items].map((item) => [item.id, item])).values()].sort(
    (a: Item, b: Item) => b.updatedAt.localeCompare(a.updatedAt),
  );
  // An inbox item Claude is waiting on shows once, under "Needs you".
  const waiting = new Set(needsYou.map((item) => item.id));
  const unsorted = inbox.items.filter((item) => !waiting.has(item.id));
  const inboxCut = inbox.total - inbox.items.length;
  // An item with both labels counts twice in the totals but once in the list, so the overlap comes back off.
  const needsYouTotal = questions.total + finished.total - (questions.items.length + finished.items.length - needsYou.length);

  return (
    <main>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight">Inbox</h1>
      <ItemSection id="unsorted" title="Unsorted" items={unsorted} total={unsorted.length + inboxCut} empty="Nothing to sort." />
      <ItemSection
        id="needs-you"
        title="Needs you"
        items={needsYou}
        total={needsYouTotal}
        empty="Nothing is waiting on you."
        showList
      />
    </main>
  );
}
