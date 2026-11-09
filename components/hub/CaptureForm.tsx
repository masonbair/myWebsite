"use client";

import { ArrowUp, Check, Lightbulb, Microphone, Stop } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { splitCapture } from "@/lib/hub/capture";
import { MAX_DESCRIPTION } from "@/lib/hub/input";
import { outboxSnapshot, retryFailedInOutbox, saveToOutbox, subscribeOutbox } from "./outbox-store";
import { focusRing, smallButton } from "./styles";
import { useVoice } from "./useVoice";

export function CaptureForm({ emptyShare }: { emptyShare: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const status = useSyncExternalStore(subscribeOutbox, outboxSnapshot, () => null);
  const [savedCount, setSavedCount] = useState(0);
  const [savedAsIdea, setSavedAsIdea] = useState(false);
  const [saveTooLong, setSaveTooLong] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (savedCount === 0) return;
    const timer = setTimeout(() => setSavedCount(0), 2500);
    return () => clearTimeout(timer);
  }, [savedCount]);

  const voice = useVoice((text) => {
    const box = field.current;
    if (!box) return;
    box.value = box.value.trim() ? `${box.value.trimEnd()} ${text}` : text;
    box.focus();
  });

  // Reads and clears the field straight from the DOM, so a second click in the same frame finds it empty.
  function save(asIdea = false) {
    const box = field.current;
    if (!box) return;
    const { title, description } = splitCapture(box.value);
    if (!title) return;
    if (description.length > MAX_DESCRIPTION) {
      setSaveTooLong(true);
      return;
    }
    setSaveTooLong(false);
    if (!saveToOutbox({ title, description, asIdea })) {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    box.value = "";
    box.focus();
    setSavedAsIdea(asIdea);
    setSavedCount((count) => count + 1);
  }

  const waiting = status?.waiting ?? 0;
  const failed = status?.failed ?? [];

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
          <div className="rounded-tile border-[2.5px] border-line bg-surface shadow-tile">
            <label htmlFor="capture-text" className="sr-only">
              Capture
            </label>
            <textarea
              id="capture-text"
              ref={field}
              autoFocus
              rows={7}
              placeholder="What's on your mind?"
              enterKeyHint="enter"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  save(event.shiftKey);
                }
              }}
              className="block min-h-[38dvh] w-full resize-none rounded-tile border-0 bg-transparent px-5 pt-5 pb-2 text-lg leading-relaxed text-ink outline-none placeholder:text-mute"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3">
              {voice.supported ? (
                <button
                  type="button"
                  onClick={voice.toggle}
                  aria-pressed={voice.listening}
                  aria-label={voice.listening ? "Stop listening" : "Speak"}
                  className={`inline-flex size-12 items-center justify-center rounded-full transition-[background-color,transform] duration-300 ease-spring active:scale-[0.96] ${
                    voice.listening ? "bg-accent text-night" : "border-2 border-line bg-surface text-ink hover:bg-canvas"
                  } ${focusRing}`}
                >
                  {voice.listening ? <Stop size={20} weight="fill" aria-hidden /> : <Microphone size={22} aria-hidden />}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => save(true)}
                  className={`inline-flex h-12 items-center gap-2 rounded-full border-[2.5px] border-line bg-surface px-4 text-sm font-bold text-ink shadow-sticker-sm transition-[translate,box-shadow] duration-200 ease-spring active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${focusRing}`}
                >
                  <Lightbulb size={18} aria-hidden />
                  Save as idea
                </button>
                <button
                  type="submit"
                  className={`group inline-flex h-12 items-center gap-3 rounded-full border-[2.5px] border-line bg-accent pr-1.5 pl-6 text-base font-bold text-night shadow-sticker-sm transition-[translate,box-shadow] duration-200 ease-spring active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${focusRing}`}
                >
                  Save
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-night/10 transition-transform duration-300 ease-spring group-hover:-translate-y-px">
                    <ArrowUp size={16} weight="bold" aria-hidden />
                  </span>
                </button>
              </div>
            </div>
          </div>
      </form>

      {voice.supported && <p className="mt-3 px-2 text-xs text-mute">Voice is turned into text by Google.</p>}

      <div aria-live="polite" className="mt-5 flex min-h-9 flex-wrap items-center gap-2 px-1 text-sm">
        {savedCount > 0 && (
          <span key={savedCount} className="inline-flex items-center gap-1.5 font-medium text-accent-ink motion-safe:animate-[fade-up_400ms_cubic-bezier(0.16,1,0.3,1)_both]">
            <Check size={14} weight="bold" aria-hidden />
            {savedAsIdea ? "Saved to Ideas" : "Saved"}
          </span>
        )}
        {emptyShare && savedCount === 0 && (
          <span role="status" className="font-medium text-ink">
            Nothing to save. The share had no text or link.
          </span>
        )}
        {waiting > 0 && (
          <span className="rounded-full border-2 border-line bg-surface px-3 py-1 font-semibold text-ink">{waiting} waiting</span>
        )}
        {status?.needsSignIn && (
          <Link href="/hub/login" className={`rounded-full px-1 font-medium text-accent-ink underline ${focusRing}`}>
            Sign in again to send
          </Link>
        )}
        {saveFailed && (
          <span role="alert" className="font-medium text-accent-ink">
            Could not save on this phone. Copy your text.
          </span>
        )}
        {saveTooLong && (
          <span role="alert" className="font-medium text-accent-ink">
            That is too long to save. Keep it under 10,000 characters.
          </span>
        )}
      </div>

      {status?.memoryOnly && (
        <p className="mt-2 rounded-2xl bg-ink/5 px-4 py-3 text-sm text-ink">
          This browser is not letting the hub store anything. Captures last only while this tab is open.
        </p>
      )}

      {failed.length > 0 && (
        <section aria-labelledby="not-sent" className="mt-8">
          <h2 id="not-sent" className="text-sm font-semibold text-ink">
            {failed.length} could not send
          </h2>
          <p className="mt-1 text-sm text-mute">The server turned these down. They are still on this phone.</p>
          <ul className="mt-3 space-y-2">
            {failed.map((entry) => (
              <li key={entry.clientKey} className="rounded-2xl bg-ink/5 px-4 py-3 text-sm break-words text-ink">
                {entry.title}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${smallButton} mt-3`}
            onClick={retryFailedInOutbox}
          >
            Try again
          </button>
        </section>
      )}
    </div>
  );
}
