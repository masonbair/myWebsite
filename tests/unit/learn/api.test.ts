import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleGrants, handlePending, handleToday, handleTranscript } from "@/lib/learn/api";
import { signGrant, signingKey } from "@/lib/learn/grant";
import { FakeLearnStore } from "./fake-store";

const TOKEN = "learn-test-token";
const OTHER = "another-endpoint-token";
const MSG = /^fl-grant-v1\|\d{4}-\d{2}-\d{2}\|com\.instagram\.android\|([1-9]|[1-5]\d|60)\|[A-Za-z0-9_-]{22}$/;

function key() {
  const pkcs8 = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" });
  return signingKey(pkcs8.subarray(pkcs8.length - 32).toString("base64"))!;
}

const get = (path: string, auth: string | null = `Bearer ${TOKEN}`) =>
  new Request(`https://masonbair.com${path}`, { headers: auth ? { authorization: auth } : {} });
const post = (path: string, body: string, auth = `Bearer ${TOKEN}`) =>
  new Request(`https://masonbair.com${path}`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body });

describe("token checks on every endpoint", () => {
  const store = new FakeLearnStore();
  const calls = {
    grants: (token: string | undefined, auth: string | null) => handleGrants(get("/api/learn/grants?date=2026-11-13", auth), { token, store }),
    today: (token: string | undefined, auth: string | null) =>
      handleToday(get("/api/learn/today", auth), { token, store, now: () => new Date("2026-11-13T12:00:00Z"), timeZone: "UTC" }),
    pending: (token: string | undefined, auth: string | null) => handlePending(get("/api/learn/voice/pending", auth), { token, store }),
    transcript: (token: string | undefined, auth: string | null) =>
      handleTranscript(post(`/api/learn/voice/${randomUUID()}/transcript`, '{"transcript":""}', auth ?? ""), randomUUID(), {
        token,
        store,
        schedule: () => {},
      }),
  };

  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: 503 with no token set, 401 for a missing, wrong or other endpoint's token`, async () => {
      expect((await call(undefined, `Bearer ${TOKEN}`)).status).toBe(503);
      expect((await call("", `Bearer ${TOKEN}`)).status).toBe(503);
      for (const auth of [null, "Bearer nope", `Bearer ${OTHER}`]) {
        const res = await call(TOKEN, auth);
        expect(res.status).toBe(401);
        expect(await res.text()).toBe('{"error":"unauthorized"}');
      }
    });
  }
});

describe("handleGrants", () => {
  it("returns only the stored msg and sig for exactly the asked date", async () => {
    const store = new FakeLearnStore();
    const k = key();
    const a = signGrant(k, "2026-11-13", 4);
    const b = signGrant(k, "2026-11-14", 3);
    store.grants.push({ ...a, answerId: "x" }, { ...b, answerId: "y" });
    const spy = vi.spyOn(store, "grantsFor");
    const res = await handleGrants(get("/api/learn/grants?date=2026-11-13"), { token: TOKEN, store });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ grants: [{ msg: a.msg, sig: a.sig }] });
    expect(spy).toHaveBeenCalledWith("2026-11-13");
    for (const g of body.grants) expect(g.msg).toMatch(MSG);
  });

  it("refuses a missing, invalid or repeated date", async () => {
    const store = new FakeLearnStore();
    for (const q of ["", "?date=2026-13-01", "?date=13-11-2026", "?date=2026-11-13&date=2026-11-14"]) {
      expect((await handleGrants(get(`/api/learn/grants${q}`), { token: TOKEN, store })).status).toBe(400);
    }
  });

  it("stays far under 64 KB with a full day of grants", async () => {
    const store = new FakeLearnStore();
    const k = key();
    for (let i = 0; i < 10; i++) store.grants.push({ ...signGrant(k, "2026-11-13", 1), answerId: `a${i}` });
    const res = await handleGrants(get("/api/learn/grants?date=2026-11-13"), { token: TOKEN, store });
    expect((await res.text()).length).toBeLessThan(64 * 1024);
  });
});

describe("handleToday", () => {
  it("returns the contract shape with the topic by name and nothing private", async () => {
    const store = new FakeLearnStore();
    store.addExercise({ id: "ex2", date: "2026-11-13", position: 2, type: "voice", topic: "communication", question: "Tell a client the launch slips." });
    store.addExercise({ id: "ex1", date: "2026-11-13", position: 1, client: "Ana, a florist" });
    store.addAnswer({ id: "a1", exerciseId: "ex1" });
    const res = await handleToday(get("/api/learn/today"), { token: TOKEN, store, now: () => new Date("2026-11-13T12:00:00Z"), timeZone: "UTC" });
    expect(await res.json()).toEqual({
      date: "2026-11-13",
      hubUrl: "https://masonbair.com/hub/learn",
      exercises: [
        {
          type: "explain",
          topic: "Explaining technical things simply",
          question: "Explain a server to a florist.",
          reading: { title: "The curse of knowledge", url: "https://hbr.org/2006/12/the-curse-of-knowledge" },
        },
        {
          type: "voice",
          topic: "Communication",
          question: "Tell a client the launch slips.",
          reading: { title: "The curse of knowledge", url: "https://hbr.org/2006/12/the-curse-of-knowledge" },
        },
      ],
    });
  });

  it("returns an empty list before the day's exercises exist", async () => {
    const res = await handleToday(get("/api/learn/today"), {
      token: TOKEN,
      store: new FakeLearnStore(),
      now: () => new Date("2026-11-13T12:00:00Z"),
      timeZone: "UTC",
    });
    expect((await res.json()).exercises).toEqual([]);
  });
});

describe("handlePending", () => {
  it("lists only clips waiting for a transcript, with a 10-minute signed URL", async () => {
    const store = new FakeLearnStore();
    store.addExercise({ id: "ex1", date: "2026-11-13" });
    store.addExercise({ id: "ex2", date: "2026-11-13", position: 2 });
    const id = randomUUID();
    store.addAnswer({ id, exerciseId: "ex1", kind: "voice", body: null, clipPath: `answers/${id}.webm`, clipMime: "audio/webm", clipDurationMs: 5000, status: "awaiting_transcript" });
    store.addAnswer({ id: "done", exerciseId: "ex2", kind: "voice", body: null, clipPath: "answers/done.webm", clipMime: "audio/webm", clipDurationMs: 5000, transcript: "hi", status: "transcribed" });
    const urlSpy = vi.spyOn(store, "clipUrl");
    const res = await handlePending(get("/api/learn/voice/pending"), { token: TOKEN, store });
    expect(await res.json()).toEqual({ clips: [{ id, url: `https://storage.test/answers/${id}.webm?token=signed`, mime: "audio/webm" }] });
    expect(urlSpy).toHaveBeenCalledWith(`answers/${id}.webm`, 600);
  });
});

describe("handleTranscript", () => {
  function voice() {
    const store = new FakeLearnStore();
    store.addExercise({ id: "ex1", date: "2026-11-13" });
    const id = randomUUID();
    store.addAnswer({ id, exerciseId: "ex1", kind: "voice", body: null, clipPath: `answers/${id}.webm`, clipMime: "audio/webm", clipDurationMs: 5000, status: "awaiting_transcript" });
    return { store, id };
  }

  it("takes an empty transcript once and schedules grading", async () => {
    const { store, id } = voice();
    const schedule = vi.fn();
    const first = await handleTranscript(post(`/x`, '{"transcript":""}'), id, { token: TOKEN, store, schedule });
    expect(first.status).toBe(204);
    expect(schedule).toHaveBeenCalledWith(id);
    const again = await handleTranscript(post(`/x`, '{"transcript":"more"}'), id, { token: TOKEN, store, schedule });
    expect(again.status).toBe(409);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    const { store } = voice();
    expect((await handleTranscript(post(`/x`, '{"transcript":"x"}'), randomUUID(), { token: TOKEN, store, schedule: () => {} })).status).toBe(404);
    expect((await handleTranscript(post(`/x`, '{"transcript":"x"}'), "abc", { token: TOKEN, store, schedule: () => {} })).status).toBe(404);
  });

  it("answers 400 for a bad body", async () => {
    const { store, id } = voice();
    for (const body of ['{"transcript":5}', "not json", JSON.stringify({ transcript: "x".repeat(20001) })]) {
      expect((await handleTranscript(post(`/x`, body), id, { token: TOKEN, store, schedule: () => {} })).status).toBe(400);
    }
  });
});
