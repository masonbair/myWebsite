"use client";

import { Microphone, Stop } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { sendTakeaway, sendTypedAnswer, sendVoiceAnswer } from "@/app/hub/learn-actions";
import { Prompt } from "@/components/board/Tile";
import { tag } from "@/components/ui/sticker";
import type { LearnCardView, LearnDay, LearnReport } from "@/lib/learn/read";
import { browserClient } from "@/lib/supabase/browser";
import { field, focusRing, panel, primaryButton, quietButton } from "../styles";
import { MinutesBar } from "./MinutesBar";
import { ReportCard } from "./ReportCard";
import { useRecorder } from "./useRecorder";

type Side = "read" | "answer";
const EXT: Record<string, string> = { "audio/webm": ".webm", "audio/mp4": ".m4a", "audio/ogg": ".ogg" };
const REFRESH_MS = 60_000;
const TOPIC_PROMPT: Record<string, string> = {
  "Explaining technical things simply": "explain --simply",
  "Understanding value": "think --value",
  "Building great products": "think --products",
  Communication: "say --out-loud",
};

/** Today's practice, one card at a time: read first, then answer. */
export function LearnCards({ day }: { day: LearnDay }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [side, setSide] = useState<Side>("read");
  const card = day.cards[index];
  const waiting = day.cards.some((c) => c.answer && !c.answer.report);

  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => router.refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [waiting, router]);

  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next: Side = side === "read" ? "answer" : "read";
    setSide(next);
    tabs.current[next === "read" ? 0 : 1]?.focus();
  };
  const go = (to: number) => {
    setIndex(to);
    setSide("read");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Today&apos;s practice</h1>
        <span className="font-mono text-sm text-mute">
          Card {index + 1} of {day.cards.length}
        </span>
      </div>

      <div role="tablist" aria-label="Card side" className="flex gap-1.5 rounded-full border-2 border-line bg-surface p-1">
        {(["read", "answer"] as const).map((s, i) => (
          <button
            key={s}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`learn-tab-${s}`}
            aria-selected={side === s}
            aria-controls="learn-card"
            tabIndex={side === s ? 0 : -1}
            onClick={() => setSide(s)}
            onKeyDown={onTabKey}
            className={`flex-1 rounded-full px-3 py-2 text-[15px] transition-colors duration-200 ease-spring ${
              side === s ? "bg-ink font-bold text-canvas" : "font-semibold text-ink hover:bg-canvas"
            } ${focusRing}`}
          >
            {i + 1} · {s === "read" ? "Read" : "Answer"}
          </button>
        ))}
      </div>

      <div id="learn-card" role="tabpanel" aria-labelledby={`learn-tab-${side}`} className={`${panel} flex flex-col gap-3 p-5`}>
        {side === "read" ? (
          <ReadSide key={card.exerciseId} card={card} onDone={() => setSide("answer")} />
        ) : (
          <AnswerSide
            key={card.exerciseId}
            card={card}
            onNext={index + 1 < day.cards.length ? () => go(index + 1) : null}
          />
        )}
      </div>

      {day.cards.length > 1 && (
        <nav aria-label="Cards" className="flex justify-between gap-2">
          <button type="button" className={quietButton} disabled={index === 0} onClick={() => go(index - 1)}>
            Previous card
          </button>
          <button type="button" className={quietButton} disabled={index + 1 >= day.cards.length} onClick={() => go(index + 1)}>
            Next card
          </button>
        </nav>
      )}

      <MinutesBar earned={day.earned} />
    </div>
  );
}

function ReadSide({ card, onDone }: { card: LearnCardView; onDone: () => void }) {
  const router = useRouter();
  const [takeaway, setTakeaway] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ feedback: string; minutes: number } | null>(card.reading.takeaway);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const out = await sendTakeaway(card.exerciseId, takeaway);
    setBusy(false);
    if (!out.ok) return setError(out.error);
    setResult({ feedback: out.feedback, minutes: out.minutes });
    router.refresh();
  }

  return (
    <>
      <Prompt className="text-mute">cat reading.txt</Prompt>
      <h2 className="text-2xl leading-tight font-bold tracking-tight">{card.reading.title}</h2>
      {card.reading.why && <p className="text-sm text-mute">Why this one: {card.reading.why}</p>}
      <div className="rounded-2xl border-2 border-line bg-tea p-4 text-night">
        <p className="text-[13px] font-bold tracking-[0.04em]">THE IDEA IN ONE BREATH</p>
        <p className="mt-1 text-[15px] leading-relaxed">{card.reading.summary}</p>
      </div>
      <a href={card.reading.url} target="_blank" rel="noopener noreferrer" className={`self-start rounded-sm font-bold text-accent-ink underline ${focusRing}`}>
        Read the full article ↗
      </a>

      {result ? (
        <p className="text-sm" role="status">
          {result.feedback} <span className="font-mono">+{result.minutes} min</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`takeaway-${card.exerciseId}`} className="text-sm font-semibold">
            One line: what did you take from it?
          </label>
          <input
            id={`takeaway-${card.exerciseId}`}
            className={`${field} h-10`}
            value={takeaway}
            maxLength={500}
            onChange={(e) => setTakeaway(e.target.value)}
          />
          <button type="button" className={`${quietButton} self-start`} disabled={busy || !takeaway.trim()} onClick={send}>
            {busy ? "Checking…" : "I read it"}
          </button>
          {error && (
            <p role="alert" className="text-sm text-accent-ink">
              {error}
            </p>
          )}
        </div>
      )}

      <button type="button" className={`${primaryButton} mt-2 justify-center`} onClick={onDone}>
        Show the question
      </button>
    </>
  );
}

function AnswerSide({ card, onNext }: { card: LearnCardView; onNext: (() => void) | null }) {
  const router = useRouter();
  const recorder = useRecorder();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<LearnReport | null>(card.answer?.report ?? null);
  const [pending, setPending] = useState<string | null>(card.answer && !card.answer.report ? "Graded soon." : null);
  const slug = TOPIC_PROMPT[card.topicName] ?? "think";
  const hasRecording = recorder.state === "stopped";

  async function send() {
    setBusy(true);
    setError(null);
    let out;
    const clip = recorder.take();
    if (clip) {
      const path = `answers/${card.exerciseId}${EXT[clip.mime] ?? ".webm"}`;
      const { error: uploadError } = await browserClient().storage.from("learn-voice").upload(path, clip.blob, { contentType: clip.mime, upsert: false });
      if (uploadError && !/exists|duplicate/i.test(uploadError.message)) {
        setBusy(false);
        return setError("The recording did not upload. Record again.");
      }
      out = await sendVoiceAnswer(card.exerciseId, { path, mime: clip.mime, durationMs: clip.durationMs });
    } else {
      out = await sendTypedAnswer(card.exerciseId, text);
    }
    setBusy(false);
    if (!out.ok) return setError(out.error);
    if (out.status === "graded") setReport(out.report);
    else setPending(out.message);
    router.refresh();
  }

  return (
    <>
      <Prompt className="text-mute">{slug}</Prompt>
      <span className={`${tag} self-start border-line bg-accent text-[11px] text-night`}>{card.topicName}</span>
      <h2 className="text-[22px] leading-snug font-bold tracking-tight">{card.question}</h2>
      {card.client && <p className="text-sm text-mute">Client: {card.client}</p>}

      {report ? (
        <>
          <ReportCard report={report} type={card.type} />
          {onNext && (
            <button type="button" className={`${primaryButton} justify-center bg-ink text-canvas`} onClick={onNext}>
              Next card
            </button>
          )}
        </>
      ) : pending ? (
        <p role="status" className="rounded-2xl border-2 border-line bg-canvas p-4 font-semibold">
          {card.answer?.kind === "voice" || pending === "Graded soon." ? "Voice note sent. Graded soon." : pending}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`answer-${card.exerciseId}`} className="text-sm font-semibold">
            Your answer
          </label>
          <textarea
            id={`answer-${card.exerciseId}`}
            rows={6}
            maxLength={8000}
            disabled={hasRecording || recorder.state === "recording"}
            placeholder={hasRecording ? "Your voice note will be sent." : ""}
            className="rounded-xl border-2 border-line bg-canvas p-3 text-[15px] text-ink outline-none placeholder:text-mute focus-visible:ring-2 focus-visible:ring-accent-ink"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center gap-2.5">
            {recorder.state === "unsupported" || recorder.state === "denied" ? (
              <p className="text-sm text-mute">Voice notes need microphone access.</p>
            ) : (
              <button
                type="button"
                aria-label={recorder.state === "recording" ? "Stop recording" : "Answer with a voice note"}
                aria-pressed={recorder.state === "recording"}
                onClick={() => (recorder.state === "recording" ? recorder.stop() : hasRecording ? recorder.reset() : recorder.start())}
                className={`grid size-12 shrink-0 place-items-center rounded-full border-2 border-line bg-tea text-night ${focusRing}`}
              >
                {recorder.state === "recording" ? <Stop size={20} weight="fill" aria-hidden /> : <Microphone size={22} weight="bold" aria-hidden />}
              </button>
            )}
            <button
              type="button"
              className={`${primaryButton} flex-1 justify-center`}
              disabled={busy || recorder.state === "recording" || (!hasRecording && !text.trim())}
              onClick={send}
            >
              {busy ? "Sending…" : "Send for grading"}
            </button>
          </div>
          {recorder.state === "recording" && (
            <p className="font-mono text-sm" role="status">
              Recording · {recorder.seconds}s · tap to stop
            </p>
          )}
          {hasRecording && <p className="text-sm text-mute">Voice note ready. Tap the mic to record again.</p>}
          {error && (
            <p role="alert" className="text-sm text-accent-ink">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
