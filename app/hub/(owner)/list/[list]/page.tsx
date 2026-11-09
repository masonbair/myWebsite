import { redirect } from "next/navigation";
import { ItemSection } from "@/components/hub/ItemRow";
import { hubMissing } from "@/lib/auth/hub-missing";
import { requireOwner } from "@/lib/auth/require-owner";
import { LIST_NAMES } from "@/lib/hub/format";
import { masonStore } from "@/lib/hub/mason-store";
import { listForPage } from "@/lib/hub/page-items";
import type { Item } from "@/lib/hub/types";

const LISTS = ["todo"] as const;

function isList(value: string): value is (typeof LISTS)[number] {
  return (LISTS as readonly string[]).includes(value);
}

// Dated items first, soonest at the top; the rest stay newest first.
function byDue(a: Item, b: Item): number {
  if (a.due && b.due) return `${a.due.date}${a.due.time ?? ""}`.localeCompare(`${b.due.date}${b.due.time ?? ""}`);
  if (a.due) return -1;
  if (b.due) return 1;
  return 0;
}

export async function generateMetadata({ params }: PageProps<"/hub/list/[list]">) {
  const { list } = await params;
  return { title: isList(list) ? LIST_NAMES[list] : "Hub" };
}

export default async function ListPage({ params }: PageProps<"/hub/list/[list]">) {
  await requireOwner();
  const { list } = await params;
  if (list === "ideas") redirect("/hub/ideas");
  if (!isList(list)) hubMissing();
  const { items, total } = await listForPage(await masonStore(), { list, state: "open" });
  items.sort(byDue);
  const name = LIST_NAMES[list];

  return (
    <main>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight">{name}</h1>
      <ItemSection id="open-items" title="Open" items={items} total={total} empty={`Nothing in ${name}.`} />
    </main>
  );
}
