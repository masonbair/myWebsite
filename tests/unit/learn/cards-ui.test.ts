import { describe, expect, it, vi } from "vitest";
import { pendingText, recordingAnnouncement, runSend } from "@/components/hub/learn/cards-ui";

describe("pendingText", () => {
  it("says voice note only for a voice answer", () => {
    expect(pendingText("voice", "Graded soon.")).toBe("Voice note sent. Graded soon.");
    expect(pendingText("typed", "Graded soon.")).toBe("Answer saved. Graded soon.");
    expect(pendingText("typed", "Grading failed. It retries on its own within 15 minutes.")).toBe(
      "Answer saved. Grading failed. It retries on its own within 15 minutes.",
    );
  });
});

describe("recordingAnnouncement", () => {
  it("announces only the start and the stop, never the ticking seconds", () => {
    expect(recordingAnnouncement("recording")).toBe("Recording started");
    expect(recordingAnnouncement("stopped")).toBe("Recording stopped");
    expect(recordingAnnouncement("idle")).toBe("");
  });
});

describe("runSend", () => {
  it("always clears busy and shows an error when the send throws", async () => {
    const setBusy = vi.fn();
    const setError = vi.fn();
    await runSend(setBusy, setError, async () => {
      throw new Error("network down");
    });
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(setError).toHaveBeenLastCalledWith("Could not send. Check your connection and try again.");
  });

  it("clears busy after a normal send", async () => {
    const setBusy = vi.fn();
    const setError = vi.fn();
    const fn = vi.fn(async () => {});
    await runSend(setBusy, setError, fn);
    expect(fn).toHaveBeenCalled();
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(setError).toHaveBeenCalledWith(null);
  });
});
