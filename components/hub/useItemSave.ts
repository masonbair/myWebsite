"use client";

import { useState, useTransition } from "react";
import { updateItemAction } from "@/app/hub/actions";
import type { ItemPatch } from "@/lib/hub/types";

/** Saves a patch to one item and reports a plain error if the server refuses. */
export function useItemSave(id: string) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function save(patch: ItemPatch, onSaved?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await updateItemAction(id, patch);
        onSaved?.();
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }
  return { pending, error, save };
}
