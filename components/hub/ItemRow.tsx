import { Check } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { completeItem } from "@/app/hub/actions";
import { formatDue, LIST_NAMES, needsYouReason } from "@/lib/hub/format";
import { STATUS_LABELS } from "@/lib/hub/rules";
import type { Item } from "@/lib/hub/types";
import { focusRing, sticker } from "./styles";
import { SubmitButton } from "./SubmitButton";

const STATUS: readonly string[] = STATUS_LABELS;

export function ItemRow({
  item,
  showList = false,
  justSaved = false,
}: {
  item: Item;
  showList?: boolean;
  justSaved?: boolean;
}) {
  const reason = needsYouReason(item.labels);
  const due = formatDue(item.due);
  const labels = item.labels.filter((label) => !STATUS.includes(label));
  return (
    <li
      data-just-saved={justSaved || undefined}
      className={`${sticker} relative flex items-start gap-1 py-1 pr-4 pl-1 transition-[translate] duration-200 ease-spring hover:-translate-y-px ${justSaved ? "bg-accent/25" : ""}`}
    >
      {/* Above the row-wide link overlay, so the tap lands on Done and not on the item. */}
      <form action={completeItem.bind(null, item.id)} className="relative z-10">
        <SubmitButton
          aria-label={`Mark ${item.title} done`}
          className={`group/done grid size-11 place-items-center rounded-full text-mute transition-colors duration-300 ease-spring hover:text-accent-ink disabled:opacity-50 ${focusRing}`}
        >
          <span className="grid size-5 place-items-center rounded-full ring-2 ring-line transition-colors duration-300 ease-spring group-hover/done:bg-accent group-hover/done:text-night group-hover/done:ring-accent">
            <Check size={12} weight="bold" className="opacity-0 group-hover/done:opacity-100" aria-hidden />
          </span>
        </SubmitButton>
      </form>
      <div className="min-w-0 flex-1 py-2.5">
        <Link
          href={`/hub/item/${item.id}`}
          className={`block leading-snug font-medium break-words text-ink after:absolute after:inset-0 ${focusRing}`}
        >
          {item.title}
        </Link>
        {(justSaved || reason || due || labels.length > 0 || showList) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-mute">
            {justSaved && <span className="font-semibold text-accent-ink">Just saved</span>}
            {reason && <span className="rounded-full border-[1.5px] border-line bg-tea px-2 py-px text-[11px] font-bold text-night">{reason}</span>}
            {showList && <span>{LIST_NAMES[item.list]}</span>}
            {due && <span>{due}</span>}
            {labels.map((label) => (
              <span key={label} className="rounded-full border-[1.5px] border-line px-2 py-px text-[11px] font-bold text-ink">
                {label}
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

/** A titled group of rows, with a plain line when it is empty. */
export function ItemSection({
  id,
  title,
  items,
  empty,
  showList,
  total = items.length,
  justSavedId,
}: {
  id: string;
  title: string;
  items: Item[];
  empty: string;
  showList?: boolean;
  /** How many items match in all, when the page could only load some of them. */
  total?: number;
  justSavedId?: string;
}) {
  return (
    <section aria-labelledby={id} className="mt-10 first:mt-0">
      <h2 id={id} className="mb-3 flex items-baseline gap-2 px-1 text-sm font-semibold text-ink">
        {title}
        <span className="font-normal text-mute">{total}</span>
      </h2>
      {total > items.length && (
        <p className="mb-3 px-1 text-sm text-mute">
          Showing {items.length} of {total}, newest first.
        </p>
      )}
      {items.length > 0 ? (
        <ul className="grid gap-2.5">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} showList={showList} justSaved={item.id === justSavedId} />
          ))}
        </ul>
      ) : (
        <p className="rounded-tile px-5 py-4 text-sm text-mute border-2 border-dashed border-line/40">{empty}</p>
      )}
    </section>
  );
}
