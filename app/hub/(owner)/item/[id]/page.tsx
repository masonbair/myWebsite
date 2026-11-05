import { ItemDetail } from "@/components/hub/ItemDetail";
import { hubMissing } from "@/lib/auth/hub-missing";
import { requireOwner } from "@/lib/auth/require-owner";
import { isItemId } from "@/lib/hub/format";
import { masonStore } from "@/lib/hub/mason-store";

export const metadata = { title: "Item" };

export default async function ItemPage({ params }: PageProps<"/hub/item/[id]">) {
  await requireOwner();
  const { id } = await params;
  if (!isItemId(id)) hubMissing();
  const store = await masonStore();
  const item = await store.getItem(id);
  if (!item) hubMissing();
  const [comments, mergedFrom, mergedInto] = await Promise.all([
    store.listComments(id),
    store.listItems({ mergedInto: id, state: "archived" }),
    item.mergedInto ? store.getItem(item.mergedInto) : null,
  ]);

  return (
    <main>
      <ItemDetail
        item={item}
        comments={comments}
        mergedFrom={mergedFrom}
        mergedInto={mergedInto}
        workerLive={process.env.HUB_WORKER_LIVE === "true"}
      />
    </main>
  );
}
