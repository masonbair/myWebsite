import { Check } from "@phosphor-icons/react/dist/ssr";
import { ItemSection } from "@/components/hub/ItemRow";
import { requireOwner } from "@/lib/auth/require-owner";
import { masonStore } from "@/lib/hub/mason-store";
import { isItemId } from "@/lib/hub/format";
import { listForPage } from "@/lib/hub/page-items";
import type { Item } from "@/lib/hub/types";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/hub">) {
  await requireOwner();
  const { saved } = await searchParams;
  const justSavedId = isItemId(saved) ? saved : undefined;
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
      {justSavedId && (
        <p
          role="status"
          className="mb-6 flex items-center gap-2 rounded-tile bg-accent/10 px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          <Check size={16} weight="bold" aria-hidden />
          Saved to inbox
        </p>
      )}
      <ItemSection
        id="unsorted"
        title="Unsorted"
        items={unsorted}
        total={unsorted.length + inboxCut}
        empty="Nothing to sort."
        justSavedId={justSavedId}
      />
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
