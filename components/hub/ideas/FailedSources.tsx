import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { retryDetection } from "@/app/hub/ideas-actions";
import type { FailedSource } from "@/lib/ideas/read";
import { SubmitButton } from "../SubmitButton";
import { focusRing, quietButton } from "../styles";

/** Captures and memos the job could not read, each with a link to the item and a Try again button. */
export function FailedSources({ sources }: { sources: FailedSource[] }) {
  const noun = sources.length === 1 ? "capture or memo" : "captures or memos";
  return (
    <section aria-labelledby="failed-sources" className="mt-6 rounded-tile px-5 py-4 ring-1 ring-ink/10 ring-inset">
      <h2 id="failed-sources" className="text-sm font-semibold text-ink">
        Could not read {sources.length} {noun}
      </h2>
      <p className="mt-1 text-sm text-mute">The Ideas Lab tried three times. Try again to look for ideas in them.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {sources.map((source) => (
          <li key={source.itemId} className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/hub/item/${source.itemId}`}
              className={`min-w-0 truncate text-sm font-medium text-accent-ink underline-offset-4 hover:underline ${focusRing}`}
            >
              {source.title}
            </Link>
            <form action={retryDetection.bind(null, source.itemId)}>
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
