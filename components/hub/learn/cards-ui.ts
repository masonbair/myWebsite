import type { RecorderState } from "./useRecorder";

/** What a waiting card says, by how it was answered; a typed answer never claims to be a voice note. */
export function pendingText(kind: "typed" | "voice", message: string): string {
  return kind === "voice" ? "Voice note sent. Graded soon." : `Answer saved. ${message}`;
}

/** The live-region text for the recorder: only its start and stop, so screen readers are not read every second. */
export function recordingAnnouncement(state: RecorderState): string {
  if (state === "recording") return "Recording started";
  if (state === "stopped") return "Recording stopped";
  return "";
}

/** Runs one send so the button always comes back and a thrown error shows instead of leaving the card stuck. */
export async function runSend(setBusy: (busy: boolean) => void, setError: (error: string | null) => void, send: () => Promise<void>): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await send();
  } catch {
    setError("Could not send. Check your connection and try again.");
  } finally {
    setBusy(false);
  }
}
