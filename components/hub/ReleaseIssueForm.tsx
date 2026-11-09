"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { releaseIssue } from "@/app/hub/news-actions";
import { field, primaryButton } from "./styles";

export function ReleaseIssueForm({ id, sources, current }: { id: string; sources: { id: string; name: string }[]; current: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function release(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await releaseIssue(id, String(formData.get("source") ?? ""));
        if (result.ok) router.push("/hub/news");
        else setError(result.error);
      } catch {
        setError("Could not release. Try again.");
      }
    });
  }

  return (
    <form action={release} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-mute">
        Newsletter
        <select name="source" required defaultValue={current ?? ""} disabled={current !== null} className={field}>
          {current === null && (
            <option value="" disabled>
              Pick one
            </option>
          )}
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {current !== null && <input type="hidden" name="source" value={current} />}
      <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButton}>
        {pending ? "Releasing" : "Release"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm font-medium text-accent-ink">
          {error}
        </p>
      )}
    </form>
  );
}
