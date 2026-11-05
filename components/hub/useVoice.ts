"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// TypeScript's DOM types here do not include the Web Speech API, so only the parts used are typed.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  const speechWindow = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

const subscribeNever = () => () => {};

/** Web Speech API dictation; `supported` is false on the server so the first render matches. */
export function useVoice(onText: (text: string) => void) {
  const supported = useSyncExternalStore(subscribeNever, () => recognitionConstructor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const latestOnText = useRef(onText);

  useEffect(() => {
    latestOnText.current = onText;
  });

  useEffect(() => () => recognition.current?.abort(), []);

  function toggle() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const RecognitionClass = recognitionConstructor();
    if (!RecognitionClass) return;
    const session = new RecognitionClass();
    session.lang = navigator.language || "en-US";
    session.interimResults = false;
    session.continuous = false;
    session.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) latestOnText.current(text);
    };
    session.onend = () => setListening(false);
    session.onerror = () => setListening(false);
    recognition.current = session;
    setListening(true);
    session.start();
  }

  return { supported, listening, toggle };
}
