import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { CommentForm } from "@/components/hub/CommentForm";
import { CommentEntry } from "@/components/hub/ItemDetail";
import { IdeaButtons, ReviewRequest } from "@/components/hub/ideas/IdeaActions";
import { reviewMark } from "@/components/hub/ideas/IdeaRow";
import { ReviewView } from "@/components/hub/ideas/ReviewView";
import { ScheduleList } from "@/components/hub/ideas/ScheduleList";
import { focusRing, panel } from "@/components/hub/styles";
import { hubMissing } from "@/lib/auth/hub-missing";
import { requireOwner } from "@/lib/auth/require-owner";
import { isItemId, LIST_NAMES } from "@/lib/hub/format";
import { getIdeaPage } from "@/lib/ideas/read";
import type { ReviewStatus } from "@/lib/ideas/types";
import { sessionClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "Idea" };

const STATUS_NOTES: Partial<Record<ReviewStatus, string>> = {
  waiting: "The ideas job checks every 15 minutes.",
  working: "Claude is reviewing it now.",
  failed: "It failed twice. Review again to retry.",
  paused: "This month's review budget is used up. It continues next month or when the cap goes up.",
};

export default async function IdeaPage({ params }: PageProps<"/hub/ideas/[id]">) {
  const { id } = await params;
  await requireOwner(`/hub/ideas/${id}`);
  if (!isItemId(id)) hubMissing();
  const page = await getIdeaPage(await sessionClient(), id);
  if (!page) hubMissing();
  const { item, settings, reviews, source, schedule, comments } = page;
  const [latest, ...earlier] = reviews;
  const open = item.state === "open";
  const status = settings?.reviewStatus ?? "none";
  const mark = reviewMark(status);

  return (
    <main>
      <article>
        <Link
          href="/hub/ideas"
          className={`inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-mute transition-colors duration-300 ease-spring hover:text-ink ${focusRing}`}
        >
          <ArrowLeft size={14} weight="bold" aria-hidden />
          Ideas Lab
        </Link>

        <h1 className="mt-4 text-2xl leading-tight font-semibold tracking-tight text-balance break-words sm:text-3xl">{item.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mute">
          {item.state === "done" && <span className="rounded-full bg-tea/40 px-2.5 py-0.5 font-medium text-ink">Done</span>}
          {item.state === "archived" && <span className="rounded-full bg-rose/30 px-2.5 py-0.5 font-medium text-ink">Archived</span>}
          {item.list !== "ideas" && <span>In {LIST_NAMES[item.list]}</span>}
          <span>Added {timeAgo(item.createdAt)}</span>
          {settings && settings.mentionCount > 1 && <span className="font-medium text-ink/80">mentioned {settings.mentionCount} times</span>}
        </p>

        {settings?.movedFromInbox && open && (
          <p className="mt-4 rounded-2xl bg-accent/10 px-4 py-3 text-sm text-ink ring-1 ring-accent/25">
            Moved here from the inbox by the Ideas Lab. If it is not an idea, send it back.
          </p>
        )}

        {item.description && <p className="mt-4 max-w-[65ch] leading-relaxed whitespace-pre-wrap text-ink/85">{item.description}</p>}

        {source && (
          <figure className="mt-5 border-l-2 border-accent pl-4">
            {source.quote && <blockquote className="max-w-[65ch] text-sm leading-relaxed text-ink/85 italic">{source.quote}</blockquote>}
            <figcaption className="mt-1 text-xs text-mute">
              From the {source.kind === "memo" ? "memo" : "capture"}{" "}
              <Link href={`/hub/item/${source.itemId}`} className={`font-semibold text-accent-ink underline-offset-4 hover:underline ${focusRing}`}>
                {source.title}
              </Link>
            </figcaption>
          </figure>
        )}

        {item.state !== "archived" && (
          <IdeaButtons
            id={item.id}
            open={open}
            isTask={item.list === "todo"}
            noWebSearch={settings?.noWebSearch ?? false}
            remindersStopped={Boolean(settings?.remindersStoppedAt)}
            movedFromInbox={Boolean(settings?.movedFromInbox)}
          />
        )}

        <section aria-labelledby="review" className={`${panel} mt-8 px-4 py-5 sm:px-6`}>
          <h2 id="review" className="text-lg font-semibold tracking-tight text-ink">
            Review
          </h2>
          {mark && (
            <p role="status" className="mt-2 text-sm">
              <span className="font-semibold text-accent-ink">{mark}.</span> <span className="text-mute">{STATUS_NOTES[status]}</span>
            </p>
          )}
          <div className="mt-4">
            {latest ? (
              <ReviewView version={latest} />
            ) : (
              <p className="text-sm text-mute">
                {settings?.enrolled ? "No review yet." : "This idea came before the Ideas Lab, so it has no review yet."}
              </p>
            )}
          </div>
          {open && <ReviewRequest id={item.id} enrolled={Boolean(settings?.enrolled)} />}
        </section>

        {earlier.length > 0 && (
          <details className="mt-6 px-1">
            <summary className={`cursor-pointer rounded-full text-sm font-semibold text-ink ${focusRing}`}>
              Earlier reviews <span className="font-normal text-mute">{earlier.length}</span>
            </summary>
            <ol className="mt-4 flex flex-col gap-8">
              {earlier.map((version) => (
                <li key={version.version} className="border-l-2 border-ink/10 pl-4">
                  <ReviewView version={version} />
                </li>
              ))}
            </ol>
          </details>
        )}

        <section aria-labelledby="returns" className="mt-10">
          <h2 id="returns" className="mb-3 px-1 text-sm font-semibold text-ink">
            Coming back
          </h2>
          <ScheduleList schedule={schedule} settings={settings} />
        </section>

        <section aria-labelledby="comments" className="mt-10">
          <h2 id="comments" className="mb-4 flex items-baseline gap-2 px-1 text-sm font-semibold text-ink">
            Comments
            <span className="font-normal text-mute">{comments.length}</span>
          </h2>
          {comments.length > 0 ? (
            <ol className="flex flex-col gap-5 px-1">
              {comments.map((comment) => (
                <CommentEntry key={comment.id} comment={comment} />
              ))}
            </ol>
          ) : (
            <p className="px-1 text-sm text-mute">No comments yet.</p>
          )}
          {item.state !== "archived" && <CommentForm itemId={item.id} />}
        </section>
      </article>
    </main>
  );
}
