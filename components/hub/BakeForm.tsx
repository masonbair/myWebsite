"use client";

import { useRef, useState, useTransition } from "react";
import { logBakeAction } from "@/app/hub/now-actions";
import { field, primaryButton } from "./styles";

const fieldClass = `${field} h-11 w-full text-base sm:text-sm`;

export function BakeForm({ maxName }: { maxName: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const local = String(data.get("bakedAt") ?? "");
    // datetime-local has no time zone, so the browser turns it into an exact time before it reaches the server.
    const bakedAt = local ? new Date(local).toISOString() : "";
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        const result = await logBakeAction({ name, photo: String(data.get("photo") ?? ""), bakedAt });
        if (!result.ok) return setError(result.error);
        form.current?.reset();
        setSaved(`Logged ${name.trim()}. It is on the site now.`);
      } catch {
        setError("Could not save the bake. Try again.");
      }
    });
  }

  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="bake-name" className="text-sm font-medium text-ink">
          What did you bake?
        </label>
        <input id="bake-name" name="name" required maxLength={maxName} autoComplete="off" className={fieldClass} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="bake-photo" className="text-sm font-medium text-ink">
          Photo path <span className="font-normal text-mute">(optional)</span>
        </label>
        <input
          id="bake-photo"
          name="photo"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="/misc/bread.webp"
          aria-describedby="bake-photo-help"
          className={`${fieldClass} font-mono`}
        />
        <p id="bake-photo-help" className="text-sm text-mute">
          A file already in the site&apos;s /misc folder.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="bake-when" className="text-sm font-medium text-ink">
          When <span className="font-normal text-mute">(optional)</span>
        </label>
        <input id="bake-when" name="bakedAt" type="datetime-local" aria-describedby="bake-when-help" className={fieldClass} />
        <p id="bake-when-help" className="text-sm text-mute">
          Leave it empty for right now.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButton}>
          Log bake
        </button>
        {error && (
          <p role="alert" className="text-sm font-medium text-accent-ink">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm font-medium text-ink">
            {saved}
          </p>
        )}
      </div>
    </form>
  );
}
