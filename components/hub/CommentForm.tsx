"use client";

import { useRef, useState, useTransition } from "react";
import { addCommentAction } from "@/app/hub/actions";
import { MAX_COMMENT } from "@/lib/hub/input";
import { focusRing, quietButton } from "./styles";

export function CommentForm({ itemId }: { itemId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = String(new FormData(event.currentTarget).get("body") ?? "").trim();
    if (!body) return;
    setError(null);
    startTransition(async () => {
      try {
        await addCommentAction(itemId, body);
        form.current?.reset();
      } catch {
        setError("Could not post. Try again.");
      }
    });
  }

  return (
    <form ref={form} onSubmit={submit} className="mt-5">
      <label htmlFor="comment-body" className="text-sm font-medium text-ink">
        Add a comment
      </label>
      <textarea
        id="comment-body"
        name="body"
        rows={3}
        maxLength={MAX_COMMENT}
        className={`mt-2 block w-full resize-y rounded-2xl border-[2.5px] border-line bg-surface px-4 py-3 text-sm text-ink shadow-sticker-sm ${focusRing}`}
      />
      <div className="mt-3 flex items-center justify-end gap-3">
        {error && (
          <p role="alert" className="text-sm font-medium text-accent-ink">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className={quietButton}>
          Post
        </button>
      </div>
    </form>
  );
}
