import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { retryDetection } from "@/app/hub/ideas-actions";
import type { FailedSource } from "@/lib/ideas/read";
import { SubmitButton } from "../SubmitButton";
import { focusRing, quietButton } from "../styles";

/** Captures, memos and HiNote recordings the job could not read, each with a Try again button; items also link to themselves. */
export function FailedSources({ sources }: { sources: FailedSource[] }) {
  const noun = sources.length === 1 ? "capture, memo or recording" : "captures, memos or recordings";
  return (
    <section aria-labelledby="failed-sources" className="mt-6 rounded-tile border-[2.5px] border-dashed border-line bg-surface px-5 py-4 shadow-sticker-sm">
      <h2 id="failed-sources" className="text-sm font-semibold text-ink">
        Could not read {sources.length} {noun}
      </h2>
      <p className="mt-1 text-sm text-mute">The Ideas Lab tried three times. Tap Try again and it looks for ideas in them again within half an hour.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {sources.map((source) => (
          <li key={source.ref} className="flex flex-wrap items-center justify-between gap-2">
            {source.itemId ? (
              <Link
                href={`/hub/item/${source.itemId}`}
                className={`min-w-0 truncate text-sm font-medium text-accent-ink underline-offset-4 hover:underline ${focusRing}`}
              >
                {source.title}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-sm font-medium text-ink">{source.title}</span>
            )}
            <form action={retryDetection.bind(null, source.ref)}>
              <SubmitButton className={quietButton}>
                <ArrowClockwise size={16} weight="bold" aria-hidden />
                Try again
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
