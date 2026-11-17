import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  clip,
  handleReport,
  isShown,
  JUDGE_SYSTEM,
  MAX_CALL_USD,
  MAX_PROMPT_CHARS,
  MAX_REPLY_CHARS,
  parseVerdict,
  sessionCapUsd,
  sessionReport,
  turnMessage,
  type SessionStore,
} from "@/lib/hub/sessions";

function reply(body: unknown, stop_reason = "end_turn") {
  return {
    model: "claude-haiku-5-5",
    stop_reason,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    usage: { input_tokens: 900, output_tokens: 40 },
  };
}

function stubClient(r: unknown) {
  const create = vi.fn().mockResolvedValue(r);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

function fakeStore(calls = 0) {
  return {
    queue: vi.fn<SessionStore["queue"]>().mockResolvedValue(),
    clear: vi.fn<SessionStore["clear"]>().mockResolvedValue(),
    end: vi.fn<SessionStore["end"]>().mockResolvedValue(),
    callsThisMonth: vi.fn<SessionStore["callsThisMonth"]>().mockResolvedValue(calls),
    recordCall: vi.fn<SessionStore["recordCall"]>().mockResolvedValue(),
  };
}

const stop = { event: "stop" as const, sessionId: "abc-123", project: "myWebsite", branch: "feat/x", prompt: "build the queue", reply: "Built it. Merge?" };
const deps = (store: SessionStore, anthropic: Anthropic | null) => ({ store, anthropic, capUsd: 3, now: () => new Date("2026-11-17T12:00:00Z") });

describe("sessionReport", () => {
  it("accepts each hook event and refuses odd session ids", () => {
    expect(sessionReport.safeParse(stop).success).toBe(true);
    expect(sessionReport.safeParse({ event: "prompt", sessionId: "abc" }).success).toBe(true);
    expect(sessionReport.safeParse({ event: "end", sessionId: "abc" }).success).toBe(true);
    expect(sessionReport.safeParse({ event: "failed", sessionId: "abc", project: "p" }).success).toBe(true);
    expect(sessionReport.safeParse({ ...stop, sessionId: "../etc" }).success).toBe(false);
    expect(sessionReport.safeParse({ ...stop, reply: "" }).success).toBe(false);
    expect(sessionReport.safeParse({ event: "other", sessionId: "abc" }).success).toBe(false);
  });
});

describe("turnMessage", () => {
  it("keeps only the end of long texts so the call stays cheap", () => {
    const msg = turnMessage({ project: "p", prompt: "z".repeat(5000), reply: "x".repeat(9000) });
    expect(msg.match(/z/g)!.length).toBe(MAX_PROMPT_CHARS - 1);
    expect(msg.match(/x/g)!.length).toBe(MAX_REPLY_CHARS - 1);
    expect(msg.length).toBeLessThan(MAX_PROMPT_CHARS + MAX_REPLY_CHARS + 200);
  });

  it("clip keeps short text as it is", () => {
    expect(clip("  hi  ", 10)).toBe("hi");
  });
});

describe("parseVerdict", () => {
  it("accepts a well-formed verdict and refuses anything else", () => {
    expect(parseVerdict({ queue: true, state: "needs_you", line: "Needs your OK." })).toEqual({ queue: true, state: "needs_you", line: "Needs your OK." });
    expect(parseVerdict({ queue: true, state: "running", line: "x" })).toBeNull();
    expect(parseVerdict({ queue: true, state: "done", line: "" })).toBeNull();
    expect(parseVerdict(null)).toBeNull();
  });
});

describe("handleReport", () => {
  it("asks Haiku with Mason's rules and queues a turn it says matters", async () => {
    const { client, create } = stubClient(reply({ queue: true, state: "needs_you", line: "Queue built; needs your OK to merge." }));
    const store = fakeStore();
    expect(await handleReport(deps(store, client), stop)).toEqual({ queued: true });
    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system).toBe(JUDGE_SYSTEM);
    expect(req.max_tokens).toBeLessThanOrEqual(150);
    expect(req.output_config.format.type).toBe("json_schema");
    expect(store.recordCall).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-5-5", purpose: "session abc-123" }));
    expect(store.queue).toHaveBeenCalledWith({ sessionId: "abc-123", project: "myWebsite", branch: "feat/x", state: "needs_you", line: "Queue built; needs your OK to merge." });
  });

  it("bills but does not queue a turn Haiku skips", async () => {
    const { client } = stubClient(reply({ queue: false, state: "done", line: "Small fix." }));
    const store = fakeStore();
    expect(await handleReport(deps(store, client), stop)).toEqual({ queued: false });
    expect(store.recordCall).toHaveBeenCalledOnce();
    expect(store.queue).not.toHaveBeenCalled();
  });

  it("treats an unreadable or refused reply as not queued", async () => {
    for (const r of [reply("not json"), reply({ queue: true, state: "done", line: "x" }, "refusal")]) {
      const store = fakeStore();
      expect(await handleReport(deps(store, stubClient(r).client), stop)).toEqual({ queued: false, skipped: "unreadable" });
      expect(store.queue).not.toHaveBeenCalled();
    }
  });

  it("skips Haiku once the month's cap is reached, and without a key", async () => {
    const { client, create } = stubClient(reply({ queue: true, state: "done", line: "x" }));
    const capped = fakeStore(Math.ceil(3 / MAX_CALL_USD));
    expect(await handleReport(deps(capped, client), stop)).toEqual({ queued: false, skipped: "capped" });
    expect(create).not.toHaveBeenCalled();
    expect(await handleReport(deps(fakeStore(), null), stop)).toEqual({ queued: false, skipped: "no-key" });
  });

  it("clears on a new prompt and ends on session close without calling Haiku", async () => {
    const { client, create } = stubClient(reply({}));
    const store = fakeStore();
    await handleReport(deps(store, client), { event: "prompt", sessionId: "abc" });
    await handleReport(deps(store, client), { event: "end", sessionId: "abc" });
    expect(store.clear).toHaveBeenCalledWith("abc");
    expect(store.end).toHaveBeenCalledWith("abc");
    expect(create).not.toHaveBeenCalled();
  });

  it("queues a failure as needing Mason without calling Haiku", async () => {
    const { client, create } = stubClient(reply({}));
    const store = fakeStore();
    await handleReport(deps(store, client), { event: "failed", sessionId: "abc", project: "p", branch: null, error: "rate_limit" });
    expect(store.queue).toHaveBeenCalledWith({ sessionId: "abc", project: "p", branch: null, state: "needs_you", line: "Stopped on an error: rate_limit." });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("isShown", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  it("hides cleared rows and sessions closed over a day ago", () => {
    expect(isShown({ state: "needs_you", endedAt: null }, now)).toBe(true);
    expect(isShown({ state: "cleared", endedAt: null }, now)).toBe(false);
    expect(isShown({ state: "done", endedAt: "2026-11-17T01:00:00Z" }, now)).toBe(true);
    expect(isShown({ state: "done", endedAt: "2026-11-16T01:00:00Z" }, now)).toBe(false);
  });
});

describe("sessionCapUsd", () => {
  it("reads the budget override and falls back to $3", () => {
    expect(sessionCapUsd({ SESSIONS_MONTHLY_BUDGET_USD: "5" })).toBe(5);
    expect(sessionCapUsd({ SESSIONS_MONTHLY_BUDGET_USD: "lots" })).toBe(3);
    expect(sessionCapUsd({})).toBe(3);
  });
});
