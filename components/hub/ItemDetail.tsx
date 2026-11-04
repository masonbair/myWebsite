import { ArrowLeft, Check } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { approveItem, completeItem, reopenItem } from "@/app/hub/actions";
import { formatDue, LIST_NAMES, listHref, needsYouReason } from "@/lib/hub/format";
import { CLAUDE_LABEL } from "@/lib/hub/rules";
import type { Comment, Item } from "@/lib/hub/types";
import { timeAgo } from "@/lib/time";
import { CommentForm } from "./CommentForm";
import { DueEditor, ListPicker } from "./ItemFields";
import { LabelEditor } from "./LabelEditor";
import { focusRing, panel, primaryButton, quietButton } from "./styles";
import { SubmitButton } from "./SubmitButton";

const AUTHOR_NAMES: Record<Comment["author"], string> = { mason: "You", worker: "Worker", agent: "Agent" };

type Props = {
  item: Item;
  comments: Comment[];
  mergedFrom: Item[];
  mergedInto: Item | null;
  workerLive: boolean;
};

export function ItemDetail({ item, comments, mergedFrom, mergedInto, workerLive }: Props) {
  const due = formatDue(item.due);
  const reason = item.state === "open" ? needsYouReason(item.labels) : null;
  const canApprove = workerLive && item.state === "open" && !item.labels.includes(CLAUDE_LABEL);

  return (
    <article>
      <Link
        href={listHref(item.list)}
        className={`inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-mute transition-colors duration-300 ease-spring hover:text-ink ${focusRing}`}
      >
        <ArrowLeft size={14} weight="bold" aria-hidden />
        {LIST_NAMES[item.list]}
      </Link>

      <h1 className="mt-4 text-2xl leading-tight font-semibold tracking-tight text-balance break-words sm:text-3xl">
        {item.title}
      </h1>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mute">
        {item.state === "done" && <span className="rounded-full bg-tea/40 px-2.5 py-0.5 font-medium text-ink">Done</span>}
        {item.state === "archived" && (
          <span className="rounded-full bg-rose/30 px-2.5 py-0.5 font-medium text-ink">Archived</span>
        )}
        {reason && <span className="font-semibold text-accent-ink">{reason}</span>}
        {due && <span>{due}</span>}
        <span>Added {timeAgo(item.createdAt)}</span>
      </p>

      {item.description && (
        <p className="mt-4 max-w-[65ch] leading-relaxed whitespace-pre-wrap text-ink/85">{item.description}</p>
      )}

      {mergedInto && (
        <p className={`${panel} mt-6 px-5 py-4 text-sm text-ink`}>
          Merged into{" "}
          <Link href={`/hub/item/${mergedInto.id}`} className={`font-semibold text-accent-ink underline-offset-4 hover:underline ${focusRing}`}>
            {mergedInto.title}
          </Link>
        </p>
      )}

      {item.state !== "archived" && (
        <div className="mt-6 flex flex-wrap gap-2">
          {item.state === "open" ? (
            <form action={completeItem.bind(null, item.id)}>
              <SubmitButton className={primaryButton}>
                <Check size={16} weight="bold" aria-hidden />
                Done
              </SubmitButton>
            </form>
          ) : (
            <form action={reopenItem.bind(null, item.id)}>
              <SubmitButton className={quietButton}>Reopen</SubmitButton>
            </form>
          )}
          {canApprove && (
            <form action={approveItem.bind(null, item.id)}>
              <SubmitButton className={quietButton} title="Hand this item to Claude">
                Approve
              </SubmitButton>
            </form>
          )}
        </div>
      )}

      <dl className={`${panel} mt-8 divide-y divide-ink/[0.06]`}>
        <Field label={<label htmlFor="item-list">List</label>}>
          <ListPicker item={item} />
        </Field>
        <Field
          label={
            <label htmlFor="item-due">
              Due<span className="sr-only"> date</span>
            </label>
          }
        >
          <DueEditor item={item} />
        </Field>
        <Field label="Labels">
          <LabelEditor itemId={item.id} labels={item.labels} />
        </Field>
      </dl>

      {mergedFrom.length > 0 && (
        <section aria-labelledby="merged-from" className="mt-10">
          <h2 id="merged-from" className="mb-3 px-1 text-sm font-semibold text-ink">
            Merged from
          </h2>
          <ul className="flex flex-col gap-1.5 px-1 text-sm">
            {mergedFrom.map((old) => (
              <li key={old.id}>
                <Link href={`/hub/item/${old.id}`} className={`text-accent-ink underline-offset-4 hover:underline ${focusRing}`}>
                  {old.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <CommentForm itemId={item.id} />
      </section>
    </article>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-4 sm:grid-cols-[6rem_1fr] sm:items-start sm:gap-4 sm:px-5">
      <dt className="text-sm font-medium text-mute sm:pt-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function CommentEntry({ comment }: { comment: Comment }) {
  const fromWorker = comment.author === "worker";
  const [firstLine, ...rest] = comment.body.split("\n");
  return (
    <li className={fromWorker ? "border-l-2 border-accent pl-4" : "pl-[18px]"}>
      <p className="flex items-baseline gap-2 text-xs text-mute">
        <span className="font-semibold text-ink">{AUTHOR_NAMES[comment.author]}</span>
        <time dateTime={comment.createdAt}>{timeAgo(comment.createdAt)}</time>
      </p>
      <div className="mt-1 max-w-[65ch] text-sm leading-relaxed break-words whitespace-pre-wrap text-ink/90">
        {fromWorker ? (
          <>
            <strong className="font-semibold text-ink">{firstLine}</strong>
            {rest.length > 0 && `\n${rest.join("\n")}`}
          </>
        ) : (
          comment.body
        )}
      </div>
    </li>
  );
}
