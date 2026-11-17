import { describe, expect, it } from "vitest";
import { handleMemoDone, MEMOS_UPLOADED } from "@/lib/hub/memo";

const TOKEN = "up-tok";
const ROUTINE = { url: "https://routine.example/fire", token: "routine-token" };

type Fetched = { url: string; init: RequestInit };

function harness(opts: { status?: number; routine?: typeof ROUTINE | null; serverToken?: string } = {}) {
  const fetched: Fetched[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    fetched.push({ url, init });
    return new Response("{}", { status: opts.status ?? 200 });
  }) as unknown as typeof fetch;
  const call = async (token: string | null = TOKEN) => {
    const res = await handleMemoDone(
      new Request("https://masonbair.com/api/memo/done", {
        method: "POST",
        headers: token === null ? {} : { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sent: 2, device: "phone" }),
      }),
      {
        token: "serverToken" in opts ? opts.serverToken : TOKEN,
        routine: opts.routine === undefined ? ROUTINE : opts.routine,
        fetchFn,
      },
    );
    return { status: res.status, json: await res.json() };
  };
  return { fetched, call };
}

describe("handleMemoDone", () => {
  it("starts one routine run with the memos-uploaded note and the routine headers", async () => {
    const h = harness();
    expect(await h.call()).toEqual({ status: 202, json: { fired: true } });
    expect(h.fetched).toHaveLength(1);
    expect(h.fetched[0].url).toBe(ROUTINE.url);
    expect(h.fetched[0].init.headers).toEqual({
      Authorization: "Bearer routine-token",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(h.fetched[0].init.body as string)).toEqual({ text: MEMOS_UPLOADED });
  });

  it("refuses a bad or missing upload token and fires nothing", async () => {
    const h = harness();
    expect((await h.call("wrong")).status).toBe(401);
    expect((await h.call(null)).status).toBe(401);
    expect(h.fetched).toHaveLength(0);
  });

  it("answers 503 when the upload token or the routine is not configured", async () => {
    expect((await harness({ serverToken: undefined }).call()).status).toBe(503);
    const h = harness({ routine: null });
    expect(await h.call()).toEqual({ status: 503, json: { error: "misconfigured", message: "routine start is not configured" } });
    expect(h.fetched).toHaveLength(0);
  });

  it("answers 502 when the routine refuses the start", async () => {
    expect((await harness({ status: 429 }).call()).status).toBe(502);
  });
});
