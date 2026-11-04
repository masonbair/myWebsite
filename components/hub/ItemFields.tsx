"use client";

import { LIST_NAMES } from "@/lib/hub/format";
import type { Item } from "@/lib/hub/types";
import { field, smallButton } from "./styles";
import { useItemSave } from "./useItemSave";

function SaveError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-sm font-medium text-accent-ink">
      {error}
    </p>
  );
}

export function ListPicker({ item }: { item: Item }) {
  const { pending, error, save } = useItemSave(item.id);
  return (
    <div>
      <select
        id="item-list"
        value={item.list}
        disabled={pending}
        onChange={(event) => save({ list: event.target.value as Item["list"] })}
        className={`${field} pr-8`}
      >
        {Object.entries(LIST_NAMES).map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
      <SaveError error={error} />
    </div>
  );
}

export function DueEditor({ item }: { item: Item }) {
  const { pending, error, save } = useItemSave(item.id);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = String(new FormData(event.currentTarget).get("date") ?? "");
    // Keep a time Todoist or a capture already set; the picker only edits the day.
    save({ due: date ? { date, time: item.due?.time ?? null } : null });
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          id="item-due"
          name="date"
          type="date"
          defaultValue={item.due?.date ?? ""}
          key={item.due?.date ?? "none"}
          className={field}
        />
        <button type="submit" disabled={pending} aria-label="Save date" className={smallButton}>
          Save
        </button>
        {item.due && (
          <button type="button" disabled={pending} onClick={() => save({ due: null })} className={smallButton}>
            Clear
          </button>
        )}
      </form>
      <SaveError error={error} />
    </div>
  );
}
