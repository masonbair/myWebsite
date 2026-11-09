"use client";

import { ArrowBendUpLeft, ArrowRight, BellSlash, Check, Sparkle } from "@phosphor-icons/react";
import { useRef, useState, useTransition } from "react";
import { completeItem, reopenItem } from "@/app/hub/actions";
import { backToInbox, promoteIdea, requestReview, setNoWebSearch, stopReminders } from "@/app/hub/ideas-actions";
import { MAX_REVIEW_NOTE } from "@/lib/ideas/types";
import { SubmitButton } from "../SubmitButton";
import { focusRing, primaryButton, quietButton } from "../styles";

type ButtonsProps = {
  id: string;
  open: boolean;
  isTask: boolean;
  noWebSearch: boolean;
  remindersStopped: boolean;
  movedFromInbox: boolean;
};

/** Done, Promote, Stop reminders, Back to inbox and the web search switch for one idea. */
export function IdeaButtons({ id, open, isTask, noWebSearch, remindersStopped, movedFromInbox }: ButtonsProps) {
  if (!open) {
    return (
      <form action={reopenItem.bind(null, id)} className="mt-6">
        <SubmitButton className={quietButton}>Reopen</SubmitButton>
      </form>
    );
  }
  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <form action={completeItem.bind(null, id)}>
          <SubmitButton className={primaryButton}>
            <Check size={16} weight="bold" aria-hidden />
            Done
          </SubmitButton>
        </form>
        {!isTask && (
          <form action={promoteIdea.bind(null, id)}>
            <SubmitButton className={quietButton} title="Move it to the Todo list and stop reminders">
              <ArrowRight size={16} weight="bold" aria-hidden />
              Promote to task
            </SubmitButton>
          </form>
        )}
        {!remindersStopped && (
          <form action={stopReminders.bind(null, id)}>
            <SubmitButton className={quietButton}>
              <BellSlash size={16} weight="bold" aria-hidden />
              Stop reminders
            </SubmitButton>
          </form>
        )}
        {movedFromInbox && (
          <form action={backToInbox.bind(null, id)}>
            <SubmitButton className={quietButton}>
              <ArrowBendUpLeft size={16} weight="bold" aria-hidden />
              Back to inbox
            </SubmitButton>
          </form>
        )}
      </div>
      <form action={setNoWebSearch.bind(null, id, !noWebSearch)} className="flex items-center gap-3">
        <SubmitButton
          role="switch"
          aria-checked={!noWebSearch}
          aria-label="Search the web during reviews"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ease-spring disabled:opacity-60 ${
            noWebSearch ? "bg-canvas" : "bg-accent"
          } border-2 border-line ${focusRing}`}
        >
          <span
            aria-hidden
            className={`absolute top-px left-px size-[18px] rounded-full border-2 border-line bg-surface transition-transform duration-300 ease-spring ${
              noWebSearch ? "" : "translate-x-5"
            }`}
          />
        </SubmitButton>
        <span className="text-sm text-ink">
          Search the web during reviews
          <span className="block text-xs text-mute">{noWebSearch ? "Off. Reviews use Claude's memory only." : "On. Up to 5 searches a review."}</span>
        </span>
      </form>
    </div>
  );
}

/** The Review again (or Review, for an idea never enrolled) form with its optional note. */
export function ReviewRequest({ id, enrolled }: { id: string; enrolled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await requestReview(id, note);
        if (result.error) setMessage(result.error);
        else form.current?.reset();
      } catch {
        setMessage("Could not ask for a review. Try again.");
      }
    });
  }

  return (
    <form ref={form} onSubmit={submit} className="mt-5">
      <label htmlFor="review-note" className="text-sm font-medium text-ink">
        Note for the review (optional)
      </label>
      <textarea
        id="review-note"
        name="note"
        rows={2}
        maxLength={MAX_REVIEW_NOTE}
        placeholder="What should it look at this time?"
        className={`mt-2 block w-full resize-y rounded-2xl border-[2.5px] border-line bg-surface px-4 py-3 text-sm text-ink shadow-sticker-sm placeholder:text-mute ${focusRing}`}
      />
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {message && (
          <p role="alert" className="text-sm font-medium text-accent-ink">
            {message}
          </p>
        )}
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={quietButton}>
          <Sparkle size={16} weight="bold" aria-hidden />
          {enrolled ? "Review again" : "Review"}
        </button>
      </div>
    </form>
  );
}
