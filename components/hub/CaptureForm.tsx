"use client";

import { ArrowUp, Check, Microphone, Stop } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { splitCapture } from "@/lib/hub/capture";
import { MAX_DESCRIPTION } from "@/lib/hub/input";
import { createOutbox, type Outbox, type OutboxEntry, type OutboxStatus } from "@/lib/hub/outbox";
import { focusRing, smallButton } from "./styles";
import { useVoice } from "./useVoice";

let sharedOutbox: Outbox | null = null;

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

// One outbox per tab, so every flush in this tab shares the same in-progress guard.
function outbox(): Outbox {
  if (sharedOutbox) return sharedOutbox;
  let storage: Pick<Storage, "getItem" | "setItem">;
  try {
    window.localStorage.setItem("hub-outbox-probe", "1");
    storage = window.localStorage;
  } catch {
    storage = memoryStorage();
  }
  sharedOutbox = createOutbox(storage);
  return sharedOutbox;
}

const statusListeners = new Set<() => void>();
let statusSnapshot: OutboxStatus | null = null;

function publishStatus() {
  statusSnapshot = outbox().status();
  for (const listener of statusListeners) listener();
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function currentStatus(): OutboxStatus {
  statusSnapshot ??= outbox().status();
  return statusSnapshot;
}

function flush() {
  publishStatus();
  void outbox().flush(send).finally(publishStatus);
}

async function send(entry: OutboxEntry): Promise<number> {
  const response = await fetch("/api/hub/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: entry.title, description: entry.description, clientKey: entry.clientKey }),
  });
  return response.status;
}

export function CaptureForm({ shared }: { shared: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const status = useSyncExternalStore(subscribeStatus, currentStatus, () => null);
  const [savedCount, setSavedCount] = useState(0);
  const [saveTooLong, setSaveTooLong] = useState(false);

  useEffect(() => {
    flush();
    const onVisible = () => document.visibilityState === "visible" && flush();
    window.addEventListener("online", flush);
    window.addEventListener("storage", publishStatus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("storage", publishStatus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

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
  function save() {
    const box = field.current;
    if (!box) return;
    const { title, description } = splitCapture(box.value);
    if (!title) return;
    if (description.length > MAX_DESCRIPTION) {
      setSaveTooLong(true);
      return;
    }
    setSaveTooLong(false);
    outbox().enqueue({ clientKey: crypto.randomUUID(), title, description, createdAt: new Date().toISOString() });
    box.value = "";
    box.focus();
    setSavedCount((count) => count + 1);
    flush();
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
        <div className="rounded-[2rem] bg-ink/5 p-1.5 ring-1 ring-ink/5">
          <div className="rounded-[calc(2rem-0.375rem)] bg-surface shadow-tile">
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
                  save();
                }
              }}
              className="block min-h-[38dvh] w-full resize-none rounded-[calc(2rem-0.375rem)] border-0 bg-transparent px-5 pt-5 pb-2 text-lg leading-relaxed text-ink outline-none placeholder:text-mute"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3">
              {voice.supported ? (
                <button
                  type="button"
                  onClick={voice.toggle}
                  aria-pressed={voice.listening}
                  aria-label={voice.listening ? "Stop listening" : "Speak"}
                  className={`inline-flex size-12 items-center justify-center rounded-full transition-[background-color,transform] duration-300 ease-spring active:scale-[0.96] ${
                    voice.listening ? "bg-accent text-night" : "bg-ink/5 text-ink hover:bg-ink/10"
                  } ${focusRing}`}
                >
                  {voice.listening ? <Stop size={20} weight="fill" aria-hidden /> : <Microphone size={22} aria-hidden />}
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                className={`group inline-flex h-12 items-center gap-3 rounded-full bg-accent pr-1.5 pl-6 text-base font-semibold text-night transition-[opacity,transform] duration-300 ease-spring hover:opacity-90 active:scale-[0.98] ${focusRing}`}
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
            Saved
          </span>
        )}
        {shared && savedCount === 0 && (
          <span className="inline-flex items-center gap-1.5 font-medium text-accent-ink">
            <Check size={14} weight="bold" aria-hidden />
            Shared item saved
          </span>
        )}
        {waiting > 0 && (
          <span className="rounded-full bg-ink/5 px-3 py-1 font-medium text-ink">{waiting} waiting</span>
        )}
        {status?.needsSignIn && (
          <Link href="/hub/login" className={`rounded-full px-1 font-medium text-accent-ink underline ${focusRing}`}>
            Sign in again to send
          </Link>
        )}
        {saveTooLong && (
          <span role="alert" className="font-medium text-accent-ink">
            That is too long to save. Keep it under 10,000 characters.
          </span>
        )}
      </div>

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
            onClick={() => {
              outbox().retryFailed();
              flush();
            }}
          >
            Try again
          </button>
        </section>
      )}
    </div>
  );
}
