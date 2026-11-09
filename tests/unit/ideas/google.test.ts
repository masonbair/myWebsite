import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const REFRESH = "refresh-SECRET-1x";
const ACCESS = "access-SECRET-2y";
const CODE = "code-SECRET-3z";
const CLIENT_SECRET = "client-SECRET-4w";
const STATE = "s".repeat(43);

let row: Row;
let token: string | null;
let rpc: ReturnType<typeof vi.fn>;
let updates: Row[];

/** Just the idea_google reads and writes and the two Vault functions, over one in-memory row. */
function fakeService() {
  return {
    from(table: string) {
      if (table !== "idea_google") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { ...row }, error: null }),
            maybeSingle: async () => ({ data: { ...row }, error: null }),
          }),
        }),
        update: (cols: Row) => ({
          eq: async () => {
            updates.push(cols);
            Object.assign(row, cols);
            return { error: null };
          },
        }),
      };
    },
    rpc,
  };
}

type Reply = { status: number; body: unknown };
let replies: { token: () => Reply; refresh: () => Reply; calendar: () => Reply; revoke: () => Reply; event: () => Reply };
let fetchFn: ReturnType<typeof makeFetch>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeFetch() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      const reply = grant === "refresh_token" ? replies.refresh() : replies.token();
      return json(reply.status, reply.body);
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      const reply = replies.revoke();
      return json(reply.status, reply.body);
    }
    if (url === "https://www.googleapis.com/calendar/v3/calendars") {
      const reply = replies.calendar();
      return json(reply.status, reply.body);
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) {
      const reply = replies.event();
      return json(reply.status, reply.body);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const checkOwner = vi.fn();
const requireOwner = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-owner", () => ({ checkOwner: () => checkOwner(), requireOwner: () => requireOwner() }));
vi.mock("@/lib/hub/mason-store", () => ({ masonStore: async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  serviceClient: () => fakeService(),
  sessionClient: async () => {
    throw new Error("Google code must not use the owner session");
  },
}));

const { GET: callback } = await import("@/app/hub/ideas/google/callback/route");
const { POST: start } = await import("@/app/hub/ideas/google/start/route");
const { disconnectGoogle } = await import("@/app/hub/ideas-actions");
const google = await import("@/lib/ideas/google");

const ORIGIN = "https://masonbair.com";

function callbackRequest(query: Record<string, string>, cookie: string | null = STATE) {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.cookie = `ideas_google_state=${cookie}`;
  return new NextRequest(`${ORIGIN}/hub/ideas/google/callback?${new URLSearchParams(query)}`, { headers });
}

function startRequest(origin: string | null = ORIGIN) {
  return new NextRequest(`${ORIGIN}/hub/ideas/google/start`, { method: "POST", headers: origin ? { origin } : {} });
}

function setCalls() {
  return rpc.mock.calls.filter(([name]) => name === "ideas_google_token_set");
}

function calledUrls() {
  return fetchFn.mock.calls.map(([url]) => String(url));
}

function expectStateCleared(res: Response) {
  expect(row.oauth_state).toBeNull();
  expect(res.headers.get("set-cookie") ?? "").toMatch(/ideas_google_state=;.*Max-Age=0/i);
}

beforeEach(() => {
  row = {
    id: true,
    connected: false,
    calendar_id: null,
    connected_at: null,
    disconnected_at: null,
    oauth_state: STATE,
    oauth_state_at: new Date(Date.now() - 60_000).toISOString(),
  };
  token = null;
  updates = [];
  rpc = vi.fn(async (name: string, args?: { p_token?: string }) => {
    if (name === "ideas_google_token_set") {
      token = args?.p_token ? args.p_token : null;
      return { data: null, error: null };
    }
    if (name === "ideas_google_token_get") return { data: token, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  replies = {
    token: () => ({ status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, token_type: "Bearer" } }),
    refresh: () => ({ status: 200, body: { access_token: ACCESS, expires_in: 3599, token_type: "Bearer" } }),
    calendar: () => ({ status: 200, body: { id: "cal-1@group.calendar.google.com", summary: "Ideas" } }),
    revoke: () => ({ status: 200, body: {} }),
    event: () => ({ status: 200, body: { id: "ev-1" } }),
  };
  fetchFn = makeFetch();
  vi.stubGlobal("fetch", fetchFn);
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", CLIENT_SECRET);
  checkOwner.mockReset();
  checkOwner.mockResolvedValue({ ok: true, userId: "owner" });
  requireOwner.mockReset();
  requireOwner.mockResolvedValue({ userId: "owner" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authUrl", () => {
  it("asks only for app-created calendars, offline, with a fresh consent and no other scopes", () => {
    const url = new URL(google.authUrl(STATE, `${ORIGIN}/hub/ideas/google/callback`, { clientId: "cid", clientSecret: "x" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      redirect_uri: `${ORIGIN}/hub/ideas/google/callback`,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.app.created",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state: STATE,
    });
  });
});

describe("start route", () => {
  it("refuses anyone but the owner before touching anything", async () => {
    checkOwner.mockResolvedValue({ ok: false, reason: "not-owner" });
    row.oauth_state = null;
    const res = await start(startRequest());
    expect(res.status).toBe(404);
    expect(updates).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a cross-site POST", async () => {
    const res = await start(startRequest("https://evil.example"));
    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it("saves a new state in the row and the cookie, then sends the owner to Google", async () => {
    row.oauth_state = null;
    const res = await start(startRequest());
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.origin).toBe("https://accounts.google.com");
    const state = to.searchParams.get("state") ?? "";
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.oauth_state).toBe(state);
    expect(Date.now() - Date.parse(String(row.oauth_state_at))).toBeLessThan(5_000);
    expect(to.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/hub/ideas/google/callback`);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`ideas_google_state=${state}`);
    expect(cookie).toMatch(/Path=\/hub\/ideas\/google/);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("sends the owner back to settings when Google keys are not set", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    const res = await start(startRequest());
    expect(res.headers.get("location")).toBe(`${ORIGIN}/hub/ideas/settings?google=not-configured`);
    expect(updates).toEqual([]);
  });
});

describe("callback route", () => {
  it("refuses anyone but the owner before reading or clearing the state", async () => {
    checkOwner.mockResolvedValue({ ok: false, reason: "not-owner" });
    const res = await callback(callbackRequest({ state: STATE, code: CODE }));
    expect(res.status).toBe(404);
    expect(updates).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(row.oauth_state).toBe(STATE);
  });

  it.each([
    ["the cookie differs", { state: STATE, code: CODE }, "t".repeat(43), STATE],
    ["the stored state differs", { state: STATE, code: CODE }, STATE, "u".repeat(43)],
    ["there is no cookie", { state: STATE, code: CODE }, null, STATE],
    ["there is no stored state", { state: STATE, code: CODE }, STATE, null],
    ["there is no state in the URL", { code: CODE }, STATE, STATE],
    ["the URL state differs from both", { state: "v".repeat(43), code: CODE }, STATE, STATE],
  ])("answers 400 and stores nothing when %s", async (_name, query, cookie, stored) => {
    row.oauth_state = stored;
    const res = await callback(callbackRequest(query, cookie));
    expect(res.status).toBe(400);
    expect(setCalls()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(row.connected).toBe(false);
    expectStateCleared(res);
  });

  it("answers 400 when the state is older than 10 minutes", async () => {
    row.oauth_state_at = new Date(Date.now() - 10 * 60_000 - 1_000).toISOString();
    const res = await callback(callbackRequest({ state: STATE, code: CODE }));
    expect(res.status).toBe(400);
    expect(setCalls()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expectStateCleared(res);
  });

  it("sends a refusal on Google's screen back to settings with a plain message", async () => {
    const res = await callback(callbackRequest({ state: STATE, error: "access_denied" }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/hub/ideas/settings?google=denied`);
    expect(setCalls()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expectStateCleared(res);
  });

  it("stores nothing when Google gives no lasting token", async () => {
    replies.token = () => ({ status: 200, body: { access_token: ACCESS, expires_in: 3599 } });
    const res = await callback(callbackRequest({ state: STATE, code: CODE }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/hub/ideas/settings?google=no-lasting-token`);
    expect(setCalls()).toEqual([]);
    expect(calledUrls()).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(row.connected).toBe(false);
    expectStateCleared(res);
  });

  it("stores the token in Vault, makes the Ideas calendar once and marks Google connected", async () => {
    const res = await callback(callbackRequest({ state: STATE, code: CODE }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/hub/ideas/settings?google=connected`);
    expect(setCalls()).toEqual([["ideas_google_token_set", { p_token: REFRESH }]]);

    const exchange = fetchFn.mock.calls[0];
    const body = new URLSearchParams(String((exchange[1] as RequestInit).body));
    expect(body.get("code")).toBe(CODE);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/hub/ideas/google/callback`);

    const created = fetchFn.mock.calls.filter(([url]) => String(url) === "https://www.googleapis.com/calendar/v3/calendars");
    expect(created).toHaveLength(1);
    expect(JSON.parse(String((created[0][1] as RequestInit).body))).toEqual({ summary: "Ideas" });
    expect(((created[0][1] as RequestInit).headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS}`);

    expect(row).toMatchObject({ connected: true, calendar_id: "cal-1@group.calendar.google.com", disconnected_at: null });
    expect(Date.now() - Date.parse(String(row.connected_at))).toBeLessThan(5_000);
    expectStateCleared(res);

    // A second connect (after a disconnect) reuses the calendar already in Mason's account.
    row.oauth_state = STATE;
    row.oauth_state_at = new Date().toISOString();
    row.connected = false;
    fetchFn.mockClear();
    const again = await callback(callbackRequest({ state: STATE, code: CODE }));
    expect(again.headers.get("location")).toBe(`${ORIGIN}/hub/ideas/settings?google=connected`);
    expect(calledUrls()).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(row).toMatchObject({ connected: true, calendar_id: "cal-1@group.calendar.google.com" });
  });

  it("reports a failed exchange without storing anything", async () => {
    replies.token = () => ({ status: 400, body: { error: "invalid_grant" } });
    const res = await callback(callbackRequest({ state: STATE, code: CODE }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/hub/ideas/settings?google=failed`);
    expect(setCalls()).toEqual([]);
    expect(row.connected).toBe(false);
  });

  it("never puts the code or a token in the redirect", async () => {
    const res = await callback(callbackRequest({ state: STATE, code: CODE }));
    const location = res.headers.get("location") ?? "";
    for (const secret of [CODE, REFRESH, ACCESS]) expect(location).not.toContain(secret);
  });
});

describe("googleFromVault", () => {
  const event = {
    summary: "Idea: a thing",
    description: "https://masonbair.com/hub/ideas/x",
    start: { dateTime: "2026-11-12T09:00:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-11-12T09:10:00", timeZone: "America/New_York" },
    visibility: "private" as const,
  };

  it("is null when the Google keys are not set", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    expect(await google.googleFromVault(fakeService() as never, fetchFn)).toBeNull();
  });

  it("is disconnected when Vault holds no token", async () => {
    expect(await google.googleFromVault(fakeService() as never, fetchFn)).toBe("disconnected");
  });

  it("refreshes one access token per run and inserts and patches events on the given calendar", async () => {
    token = REFRESH;
    const cal = await google.googleFromVault(fakeService() as never, fetchFn);
    if (cal === null || cal === "disconnected") throw new Error("expected a calendar");
    expect(await cal.insertEvent("cal/1@x", event)).toBe("ev-1");
    await cal.patchEvent("cal/1@x", "ev 1", { summary: "Idea (closed): a thing" });
    const urls = calledUrls();
    expect(urls.filter((u) => u === "https://oauth2.googleapis.com/token")).toHaveLength(1);
    expect(urls).toContain(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent("cal/1@x")}/events`);
    expect(urls).toContain(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent("cal/1@x")}/events/${encodeURIComponent("ev 1")}`,
    );
    const patch = fetchFn.mock.calls.find(([u]) => String(u).endsWith(encodeURIComponent("ev 1")));
    expect((patch?.[1] as RequestInit).method).toBe("PATCH");
  });

  it("throws GoogleRevoked when the token endpoint says invalid_grant", async () => {
    token = REFRESH;
    replies.refresh = () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
    const cal = await google.googleFromVault(fakeService() as never, fetchFn);
    if (cal === null || cal === "disconnected") throw new Error("expected a calendar");
    await expect(cal.insertEvent("cal-1", event)).rejects.toBeInstanceOf(google.GoogleRevoked);
  });

  it("throws a plain GoogleError, not GoogleRevoked, for other failures", async () => {
    token = REFRESH;
    replies.event = () => ({ status: 500, body: { error: { code: 500, status: "INTERNAL" } } });
    const cal = await google.googleFromVault(fakeService() as never, fetchFn);
    if (cal === null || cal === "disconnected") throw new Error("expected a calendar");
    const failure = await cal.insertEvent("cal-1", event).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(google.GoogleError);
    expect(failure).not.toBeInstanceOf(google.GoogleRevoked);
  });
});

describe("disconnectGoogle", () => {
  beforeEach(() => {
    token = REFRESH;
    Object.assign(row, { connected: true, calendar_id: "cal-1", connected_at: "2026-11-01T00:00:00Z", oauth_state: null });
  });

  it("checks the owner first", async () => {
    requireOwner.mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(disconnectGoogle()).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(row.connected).toBe(true);
  });

  it("revokes at Google, blanks the Vault secret and keeps the calendar id", async () => {
    await disconnectGoogle();
    const revoke = fetchFn.mock.calls.find(([u]) => String(u) === "https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(String((revoke?.[1] as RequestInit).body)).get("token")).toBe(REFRESH);
    expect(setCalls()).toEqual([["ideas_google_token_set", { p_token: "" }]]);
    expect(token).toBeNull();
    expect(row).toMatchObject({ connected: false, calendar_id: "cal-1" });
    expect(Date.now() - Date.parse(String(row.disconnected_at))).toBeLessThan(5_000);
  });

  it("still blanks when Google says the token is already dead (400)", async () => {
    replies.revoke = () => ({ status: 400, body: { error: "invalid_token" } });
    await disconnectGoogle();
    expect(setCalls()).toEqual([["ideas_google_token_set", { p_token: "" }]]);
    expect(row.connected).toBe(false);
  });

  it("keeps the token when Google cannot be reached, so it can still be revoked later", async () => {
    replies.revoke = () => ({ status: 503, body: {} });
    await expect(disconnectGoogle()).rejects.toThrow(/revoke/);
    expect(setCalls()).toEqual([]);
    expect(row.connected).toBe(true);
  });
});

describe("secrets in logs", () => {
  it("never logs the code, a token or the client secret on any path", async () => {
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }

    await callback(callbackRequest({ state: STATE, code: CODE }));

    row.oauth_state = STATE;
    row.oauth_state_at = new Date().toISOString();
    row.calendar_id = null;
    replies.calendar = () => ({ status: 500, body: { error: { message: `echo ${ACCESS}` } } });
    await callback(callbackRequest({ state: STATE, code: CODE }));

    row.oauth_state = STATE;
    row.oauth_state_at = new Date().toISOString();
    replies.token = () => ({ status: 400, body: { error: "invalid_grant", error_description: `bad ${CODE}` } });
    await callback(callbackRequest({ state: STATE, code: CODE }));

    token = REFRESH;
    replies.refresh = () => ({ status: 400, body: { error: "invalid_grant" } });
    const cal = await google.googleFromVault(fakeService() as never, fetchFn);
    if (cal !== null && cal !== "disconnected") await cal.patchEvent("c", "e", {}).catch((e: unknown) => console.error(e));

    replies.revoke = () => ({ status: 503, body: { error: `echo ${REFRESH}` } });
    await disconnectGoogle().catch((e: unknown) => console.error(e));

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      for (const secret of [CODE, REFRESH, ACCESS, CLIENT_SECRET]) expect(line).not.toContain(secret);
    }
  });
});
