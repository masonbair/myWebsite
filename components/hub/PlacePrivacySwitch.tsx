"use client";

import { useState, useTransition } from "react";
import { setPlacePrivateAction } from "@/app/hub/now-actions";
import { focusRing } from "./styles";

export function PlacePrivacySwitch({ isPrivate }: { isPrivate: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setPlacePrivateAction(!isPrivate);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span id="place-private-label" className="text-sm font-medium text-ink">
          Mark this place private
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isPrivate}
          aria-labelledby="place-private-label"
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={toggle}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-300 ease-spring disabled:opacity-60 ${
            isPrivate ? "bg-accent" : "bg-ink/15"
          } ${focusRing}`}
        >
          <span
            aria-hidden
            className={`size-6 rounded-full bg-surface shadow-sm transition-transform duration-300 ease-spring ${
              isPrivate ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      <p className="mt-1.5 text-sm text-mute">Private hides the city. The site shows only the state and country.</p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-accent-ink">
          {error}
        </p>
      )}
    </div>
  );
}
