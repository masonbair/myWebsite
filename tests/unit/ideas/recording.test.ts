import { describe, expect, it, vi } from "vitest";
import { handleRecording, type RecordingDeps } from "@/lib/ideas/recording";
import type { Recording } from "@/lib/hub/memo";

const TOKEN = "recording-token";
const good = { file: "2026Nov08-090000-Rec01", recorded: "2026-11-08T09:00:00-05:00", transcript: "an idea: a sourdough timer" };

/** An in-memory idea_recordings that keeps the first row per file, like `on conflict (file) do nothing`. */
function harness() {
  const rows = new Map<string, Recording>();
  const deps: RecordingDeps = {
    token: TOKEN,
    insert: async (r) => {
      if (rows.has(r.file)) return "duplicate";
      rows.set(r.file, r);
      return "created";
    },
  };
  return { rows, deps };
}

function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("https://masonbair.com/api/hub/ideas/recording", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/hub/ideas/recording", () => {
  it("saves a new recording with 201", async () => {
    const h = harness();
    const res = await handleRecording(post(good), h.deps);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "created" });
    expect(h.rows.get(good.file)).toEqual(good);
  });

  it.each(["2026-11-08T14:00:00Z", "2026-11-08T09:00:00-05:00", "2026-11-08T19:30:00+05:30", "2026-11-09T04:00:00+14:00"])(
    "accepts %s",
    async (recorded) => {
      const h = harness();
      expect((await handleRecording(post({ ...good, recorded }), h.deps)).status).toBe(201);
      expect(h.rows.get(good.file)?.recorded).toBe(recorded);
    },
  );

  it("answers a resend with 200 and keeps the first copy", async () => {
    const h = harness();
    await handleRecording(post(good), h.deps);
    const res = await handleRecording(post({ ...good, transcript: "something else" }), h.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "duplicate" });
    expect(h.rows.size).toBe(1);
    expect(h.rows.get(good.file)?.transcript).toBe(good.transcript);
  });

  it("refuses a missing or wrong token with 401 and saves nothing", async () => {
    const h = harness();
    expect((await handleRecording(post(good, null), h.deps)).status).toBe(401);
    expect((await handleRecording(post(good, "Bearer wrong"), h.deps)).status).toBe(401);
    expect(h.rows.size).toBe(0);
  });

  it("answers 503 when IDEAS_RECORDING_TOKEN is not set", async () => {
    const h = harness();
    expect((await handleRecording(post(good), { ...h.deps, token: undefined })).status).toBe(503);
    expect(h.rows.size).toBe(0);
  });

  it.each([
    ["a path as the file name", { ...good, file: "../secrets" }],
    ["a file name with a space", { ...good, file: "my memo" }],
    ["a time that is not real", { ...good, recorded: "2026-02-30T09:00:00-05:00" }],
    ["a time without an offset", { ...good, recorded: "2026-11-08T09:00:00" }],
    ["an hour that is not real", { ...good, recorded: "2026-11-08T25:00:00Z" }],
    ["an offset with minutes over 59", { ...good, recorded: "2026-11-08T09:00:00+05:75" }],
    ["an offset over 14 hours", { ...good, recorded: "2026-11-08T09:00:00+15:00" }],
    ["an offset without a colon", { ...good, recorded: "2026-11-08T09:00:00-0500" }],
    ["fractional seconds", { ...good, recorded: "2026-11-08T09:00:00.123Z" }],
    ["a date only", { ...good, recorded: "2026-11-08" }],
    ["an empty transcript", { ...good, transcript: "  " }],
    ["no file", { recorded: good.recorded, transcript: good.transcript }],
    ["a body that is not JSON", "not json"],
  ])("refuses %s with 400", async (_, body) => {
    const h = harness();
    const res = await handleRecording(post(body), h.deps);
    expect(res.status).toBe(400);
    expect(h.rows.size).toBe(0);
  });

  it("refuses a body over 1 MB with 413", async () => {
    const h = harness();
    const res = await handleRecording(post({ ...good, transcript: "x".repeat(1_000_001) }), h.deps);
    expect(res.status).toBe(413);
    expect(h.rows.size).toBe(0);
  });

  it("answers 502 and logs only the file name when the database fails", async () => {
    const h = harness();
    h.deps.insert = async () => {
      throw new Error("db down");
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleRecording(post(good), h.deps);
    expect(res.status).toBe(502);
    expect(error.mock.calls.flat().join(" ")).toContain(good.file);
    expect(error.mock.calls.flat().join(" ")).not.toContain("sourdough");
    error.mockRestore();
  });
});
