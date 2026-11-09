import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { isItemId } from "@/lib/hub/format";
import type { IdeaReviewVersion } from "@/lib/ideas/read";
import { timeAgo } from "@/lib/time";
import { focusRing } from "../styles";
import { VerdictChip } from "./IdeaRow";

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t-2 border-dashed border-line/20 pt-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 max-w-[65ch] text-sm leading-relaxed text-ink/85">{children}</div>
    </section>
  );
}

// Review links come from Claude's web search, so only plain https links render, and always as a new tab with no referrer.
function SafeLink({ url, children }: { url: string | null; children: ReactNode }) {
  if (!url || !url.startsWith("https://")) return <span className="font-semibold text-ink">{children}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-0.5 font-semibold text-accent-ink underline-offset-4 hover:underline ${focusRing}`}
    >
      {children}
      <ArrowUpRight size={12} weight="bold" aria-hidden />
    </a>
  );
}

/** One saved review version, or a plain line when its stored JSON no longer parses. */
export function ReviewView({ version }: { version: IdeaReviewVersion }) {
  const { review } = version;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        {review && <VerdictChip verdict={review.verdict} />}
        <span>
          Version {version.version}, <time dateTime={version.createdAt}>{timeAgo(version.createdAt)}</time>
        </span>
      </p>
      {version.note && <p className="text-sm text-mute">You asked: {version.note}</p>}

      {!review ? (
        <p className="text-sm text-mute">Review could not be shown.</p>
      ) : (
        <>
          <p className="max-w-[65ch] text-base leading-relaxed text-ink">{review.why}</p>

          <Part title="Who it is for">
            <p>{review.audience}</p>
          </Part>

          <Part title="Already out there">
            {review.existing.length === 0 ? (
              <p>Nothing close turned up.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {review.existing.map((thing, i) => (
                  <li key={`${thing.name}-${i}`}>
                    <SafeLink url={thing.url}>{thing.name}</SafeLink>
                    <span className="block text-ink/75">{thing.difference}</span>
                  </li>
                ))}
              </ul>
            )}
            {review.fromMemoryOnly && <p className="mt-2 text-xs text-mute">From Claude&apos;s memory, without a web search.</p>}
          </Part>

          <Part title="Weak spots and fixes">
            <ul className="flex flex-col gap-3">
              {review.weakSpots.map((spot, i) => (
                <li key={i}>
                  <span className="block font-medium text-ink">{spot.problem}</span>
                  <span className="block text-ink/75">Fix: {spot.fix}</span>
                </li>
              ))}
            </ul>
          </Part>

          <Part title="Other ways to do it">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-accent">
              {review.variations.map((variation, i) => (
                <li key={i}>{variation}</li>
              ))}
            </ul>
          </Part>

          <Part title="A weekend test">
            <p>
              <span className="font-medium text-ink">Build: </span>
              {review.weekend.build}
            </p>
            <p className="mt-1">
              <span className="font-medium text-ink">It works if: </span>
              {review.weekend.signal}
            </p>
          </Part>

          {review.links.some((link) => isItemId(link.ideaId)) && (
            <Part title="Related ideas">
              <ul className="flex flex-col gap-1.5">
                {review.links
                  .filter((link) => isItemId(link.ideaId))
                  .map((link) => (
                    <li key={link.ideaId}>
                      <Link
                        href={`/hub/ideas/${link.ideaId}`}
                        className={`font-semibold text-accent-ink underline-offset-4 hover:underline ${focusRing}`}
                      >
                        Open idea
                      </Link>{" "}
                      <span className="text-ink/75">{link.how}</span>
                    </li>
                  ))}
              </ul>
            </Part>
          )}
        </>
      )}
    </div>
  );
}
