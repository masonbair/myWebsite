"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { setPhotoHiddenAction } from "@/app/hub/now-actions";
import { collectorPhotoAlt, collectorPhotoLoader } from "@/lib/collector-photos";
import { tag } from "@/components/ui/sticker";
import { smallButton } from "./styles";

const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export type PhonePhotoLabel = {
  /** null until Claude labels the photo. */
  kind: string | null;
  /** null when not labeled yet, or when the description failed the privacy check. */
  description: string | null;
  /** Where the site shows it right now: slideshow or coffee. */
  shownOn: string[];
};

export function PhonePhotoCard({
  assetId,
  takenAt,
  hidden,
  label,
}: {
  assetId: string;
  takenAt: string;
  hidden: boolean;
  label: PhonePhotoLabel;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const day = DAY.format(new Date(takenAt));

  function toggle() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setPhotoHiddenAction(assetId, !hidden);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <li className="flex flex-col gap-2">
      <div className="relative aspect-square overflow-hidden rounded-2xl border-[2.5px] border-line bg-ink/5 shadow-sticker-sm">
        <Image
          src={`/hub/photos/${assetId}`}
          loader={collectorPhotoLoader}
          alt={label.description ?? collectorPhotoAlt(takenAt)}
          fill
          sizes="(min-width: 640px) 160px, 45vw"
          className={`object-cover transition-opacity duration-300 ease-spring ${hidden ? "opacity-35 grayscale" : ""}`}
        />
        {hidden && (
          <span className="absolute top-2 left-2 rounded-full border-2 border-night bg-snow px-2.5 py-0.5 text-xs font-bold text-night">Hidden</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-0.5">
        <time dateTime={takenAt} className="text-xs whitespace-nowrap text-mute">
          {day}
        </time>
        <button
          type="button"
          aria-label={`${hidden ? "Show" : "Hide"} photo from ${day}`}
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={toggle}
          className={smallButton}
        >
          {hidden ? "Show" : "Hide"}
        </button>
      </div>
      <div className="flex flex-col gap-1.5 px-0.5">
        <p className="text-xs leading-snug text-ink">
          {label.kind === null ? <span className="text-mute">Waiting for a label</span> : (label.description ?? <span className="text-mute">No description</span>)}
        </p>
        <ul aria-label="Kind and where it shows" className="flex flex-wrap gap-1">
          {label.kind && <li className={`${tag} border-line bg-canvas text-xs text-mute`}>{label.kind}</li>}
          {label.shownOn.map((place) => (
            <li key={place} className={`${tag} border-line bg-accent text-xs text-night`}>
              {place}
            </li>
          ))}
          {!hidden && label.shownOn.length === 0 && label.kind !== null && <li className="text-xs text-mute">Not on the site</li>}
        </ul>
      </div>
      {error && (
        <p role="alert" className="px-1 text-sm font-medium text-accent-ink">
          {error}
        </p>
      )}
    </li>
  );
}
