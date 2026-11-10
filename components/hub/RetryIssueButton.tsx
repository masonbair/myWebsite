"use client";

import { useState, useTransition } from "react";
import { retryIssue } from "@/app/hub/news-actions";
import { smallButton } from "./styles";

export function RetryIssueButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function retry() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await retryIssue(id);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Could not retry. Try again.");
      }
    });
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" onClick={retry} disabled={pending} aria-busy={pending || undefined} className={smallButton}>
        {pending ? "Retrying" : "Retry"}
      </button>
      {error && (
        <span role="alert" className="text-sm font-medium text-accent-ink">
          {error}
        </span>
      )}
    </span>
  );
}
