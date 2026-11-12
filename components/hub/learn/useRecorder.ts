"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
const MAX_SECONDS = 300;

export type RecorderState = "idle" | "recording" | "stopped" | "unsupported" | "denied";
export type Recording = { blob: Blob; mime: string; durationMs: number };

function supportedType(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Records real audio for a voice answer; the length is measured here because recorded webm files carry none. */
export function useRecorder() {
  const supported = useSyncExternalStore(
    () => () => {},
    () => supportedType() !== null,
    () => false,
  );
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const result = useRef<Recording | null>(null);
  const ticker = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (ticker.current !== null) window.clearInterval(ticker.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    const type = supportedType();
    if (!type) {
      setState("unsupported");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("denied");
      return;
    }
    chunks.current = [];
    result.current = null;
    const rec = new MediaRecorder(stream, { mimeType: type });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const mime = type.split(";")[0];
      result.current = { blob: new Blob(chunks.current, { type: mime }), mime, durationMs: Math.round(performance.now() - startedAt.current) };
      stream.getTracks().forEach((t) => t.stop());
      if (ticker.current !== null) window.clearInterval(ticker.current);
      setState("stopped");
    };
    recorder.current = rec;
    startedAt.current = performance.now();
    setSeconds(0);
    rec.start(1000);
    setState("recording");
    ticker.current = window.setInterval(() => {
      const s = Math.floor((performance.now() - startedAt.current) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) rec.stop();
    }, 250);
  }, []);

  const take = useCallback((): Recording | null => result.current, []);
  const reset = useCallback(() => {
    result.current = null;
    setSeconds(0);
    setState("idle");
  }, []);

  return { state: supported || state === "denied" ? state : "unsupported", seconds, start, stop, take, reset };
}
