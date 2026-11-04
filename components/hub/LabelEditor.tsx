"use client";

import { Plus, X } from "@phosphor-icons/react";
import { useState } from "react";
import { LABEL_PATTERN, MAX_LABEL_LENGTH, normalizeLabel } from "@/lib/hub/input";
import { field, focusRing, smallButton } from "./styles";
import { useItemSave } from "./useItemSave";

export function LabelEditor({ itemId, labels }: { itemId: string; labels: string[] }) {
  const { pending, error: saveError, save } = useItemSave(itemId);
  const [draft, setDraft] = useState("");
  const [shapeError, setShapeError] = useState<string | null>(null);
  const error = shapeError ?? saveError;

  function add(event: React.FormEvent) {
    event.preventDefault();
    const label = normalizeLabel(draft);
    if (!label) return;
    if (!LABEL_PATTERN.test(label)) {
      return setShapeError("Labels use letters, numbers, - _ and : only.");
    }
    setShapeError(null);
    if (labels.includes(label)) return setDraft("");
    save({ labels: [...labels, label] }, () => setDraft(""));
  }

  return (
    <div className="min-w-0">
      {labels.length > 0 ? (
        <ul aria-label="Labels" className="flex flex-wrap gap-1.5">
          {labels.map((label) => (
            <li key={label} className="inline-flex items-center gap-0.5 rounded-full bg-ink/5 py-0.5 pr-0.5 pl-2.5 text-sm text-ink">
              {label}
              <button
                type="button"
                onClick={() => save({ labels: labels.filter((l) => l !== label) })}
                disabled={pending}
                aria-label={`Remove ${label}`}
                className={`grid size-6 place-items-center rounded-full text-mute transition-colors duration-300 ease-spring hover:bg-ink/10 hover:text-ink disabled:opacity-50 ${focusRing}`}
              >
                <X size={12} weight="bold" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-mute">No labels yet.</p>
      )}
      <form onSubmit={add} className="mt-2.5 flex gap-2">
        <label htmlFor={`new-label-${itemId}`} className="sr-only">
          New label
        </label>
        <input
          id={`new-label-${itemId}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_LABEL_LENGTH}
          autoComplete="off"
          className={`${field} w-full min-w-0 max-w-56`}
        />
        <button type="submit" disabled={pending} aria-label="Add label" className={`${smallButton} gap-1`}>
          <Plus size={14} weight="bold" aria-hidden />
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-accent-ink">
          {error}
        </p>
      )}
    </div>
  );
}
