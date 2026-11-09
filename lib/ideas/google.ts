import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isLocalHost } from "@/lib/auth/return-cookie";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDARS_URL = "https://www.googleapis.com/calendar/v3/calendars";

export const CALLBACK_PATH = "/hub/ideas/google/callback";
export const SETTINGS_PATH = "/hub/ideas/settings";
export const STATE_COOKIE = "ideas_google_state";
export const STATE_COOKIE_PATH = "/hub/ideas/google";
export const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const CALENDAR_NAME = "Ideas";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type GoogleConfig = { clientId: string; clientSecret: string };

export type EventTime = { dateTime: string; timeZone: string } | { date: string };
export type CalendarEvent = {
  /** Set by the caller so a retried insert answers 409 instead of making a second event. */
  id?: string;
  summary: string;
  description?: string;
  start: EventTime;
  end: EventTime;
  visibility?: "default" | "public" | "private" | "confidential";
  reminders?: { useDefault: boolean; overrides?: { method: "popup" | "email"; minutes: number }[] };
};

/** The Ideas calendar's two write calls; ids are Google's. */
export interface GoogleCalendar {
  insertEvent(calendarId: string, ev: CalendarEvent): Promise<string>;
  patchEvent(calendarId: string, eventId: string, patch: Partial<CalendarEvent>): Promise<void>;
}

/** The refresh token no longer works: Mason removed the app or Google expired it. */
export class GoogleRevoked extends Error {
  constructor() {
    super("google access was revoked (invalid_grant)");
    this.name = "GoogleRevoked";
  }
}

/** A Google call failed; the message holds only the step, HTTP status and Google's short error code. */
export class GoogleError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`google ${step} failed: ${status}${code ? ` ${code}` : ""}`);
    this.name = "GoogleError";
  }
}

/** GOOGLE_OAUTH_CLIENT_ID and _SECRET, or null when either is unset. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** @param host the request's Host header; Secure is left off only for local dev over plain http. */
export function stateCookieOptions(host: string) {
  return { httpOnly: true, secure: !isLocalHost(host), sameSite: "lax" as const, path: STATE_COOKIE_PATH, maxAge: STATE_MAX_AGE_MS / 1000 };
}

export const clearedStateCookie = { httpOnly: true, sameSite: "lax" as const, path: STATE_COOKIE_PATH, maxAge: 0 };

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time equality; empty or missing values never match. */
export function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Google's consent screen URL; `redirectUri` must match one listed on the OAuth client exactly. */
export function authUrl(state: string, redirectUri: string, config: GoogleConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

// Only a short code word from Google's reply is kept, since error descriptions can echo request values.
async function errorCode(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const raw = typeof body?.error === "string" ? body.error : (body?.error as { status?: unknown } | undefined)?.status;
  return typeof raw === "string" && /^[A-Za-z_]{1,64}$/.test(raw) ? raw : null;
}

async function postForm(fetchFn: FetchFn, url: string, form: Record<string, string>): Promise<Response> {
  return fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  config: GoogleConfig,
  fetchFn: FetchFn,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await postForm(fetchFn, TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!res.ok) throw new GoogleError("code exchange", res.status, await errorCode(res));
  const body = (await res.json()) as { access_token?: unknown; refresh_token?: unknown };
  if (typeof body.access_token !== "string") throw new GoogleError("code exchange", res.status, "no_access_token");
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null };
}

async function refreshAccessToken(refreshToken: string, config: GoogleConfig, fetchFn: FetchFn): Promise<string> {
  const res = await postForm(fetchFn, TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  if (!res.ok) {
    const code = await errorCode(res);
    if (code === "invalid_grant") throw new GoogleRevoked();
    throw new GoogleError("token refresh", res.status, code);
  }
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") throw new GoogleError("token refresh", res.status, "no_access_token");
  return body.access_token;
}

async function calendarCall(fetchFn: FetchFn, step: string, accessToken: string, method: string, url: string, body: unknown) {
  const res = await fetchFn(url, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new GoogleError(step, res.status, await errorCode(res));
  return (await res.json().catch(() => ({}))) as { id?: unknown };
}

function eventsUrl(calendarId: string, eventId?: string): string {
  const base = `${CALENDARS_URL}/${encodeURIComponent(calendarId)}/events`;
  return eventId === undefined ? base : `${base}/${encodeURIComponent(eventId)}`;
}

async function readToken(service: SupabaseClient): Promise<string | null> {
  const { data, error } = await service.rpc("ideas_google_token_get");
  if (error) throw new Error(`could not read the google token: ${error.code ?? "unknown"}`);
  return typeof data === "string" && data ? data : null;
}

async function writeToken(service: SupabaseClient, token: string): Promise<void> {
  const { error } = await service.rpc("ideas_google_token_set", { p_token: token });
  if (error) throw new Error(`could not store the google token: ${error.code ?? "unknown"}`);
}

async function updateGoogleRow(service: SupabaseClient, columns: Record<string, unknown>): Promise<void> {
  const { error } = await service.from("idea_google").update(columns).eq("id", true);
  if (error) throw new Error(`could not update idea_google: ${error.code ?? "unknown"}`);
}

export type GoogleRow = {
  connected: boolean;
  calendar_id: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  oauth_state: string | null;
  oauth_state_at: string | null;
};

export async function readGoogleRow(service: SupabaseClient): Promise<GoogleRow> {
  const { data, error } = await service
    .from("idea_google")
    .select("connected, calendar_id, connected_at, disconnected_at, oauth_state, oauth_state_at")
    .eq("id", true)
    .single();
  if (error || !data) throw new Error(`could not read idea_google: ${error?.code ?? "no row"}`);
  return data as GoogleRow;
}

/** Saves a one-time state for the start route; the caller has already checked the owner. */
export async function saveState(service: SupabaseClient, state: string): Promise<void> {
  await updateGoogleRow(service, { oauth_state: state, oauth_state_at: new Date().toISOString() });
}

export async function clearState(service: SupabaseClient): Promise<void> {
  await updateGoogleRow(service, { oauth_state: null, oauth_state_at: null });
}

const STATE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Clears the saved state in one statement; true only when it equalled `presented` and was under 10 minutes old. */
export async function claimState(service: SupabaseClient, presented: string | null, now: Date): Promise<boolean> {
  let claimed = false;
  if (presented && STATE_SHAPE.test(presented)) {
    const { data, error } = await service
      .from("idea_google")
      .update({ oauth_state: null, oauth_state_at: null })
      .eq("id", true)
      .eq("oauth_state", presented)
      .gt("oauth_state_at", new Date(now.getTime() - STATE_MAX_AGE_MS).toISOString())
      .select("id");
    if (error) throw new Error(`could not claim the oauth state: ${error.code ?? "unknown"}`);
    claimed = (data ?? []).length === 1;
  }
  // A state that did not match is still single use: clear whatever is saved.
  if (!claimed) await clearState(service);
  return claimed;
}

/** Makes the Ideas calendar unless one is saved, then stores the refresh token and marks Google connected; stores nothing without a refresh token. */
export async function connectGoogle(
  service: SupabaseClient,
  opts: { code: string; redirectUri: string; config: GoogleConfig; fetchFn: FetchFn },
): Promise<"connected" | "no-refresh-token"> {
  const { accessToken, refreshToken } = await exchangeCode(opts.code, opts.redirectUri, opts.config, opts.fetchFn);
  if (!refreshToken) return "no-refresh-token";
  // Calendar first: a failure here must leave no live token in Vault behind a "Not connected" page.
  if (!(await readGoogleRow(service)).calendar_id) {
    const created = await calendarCall(opts.fetchFn, "calendar create", accessToken, "POST", CALENDARS_URL, { summary: CALENDAR_NAME });
    if (typeof created.id !== "string") throw new GoogleError("calendar create", 200, "no_calendar_id");
    await updateGoogleRow(service, { calendar_id: created.id });
  }
  await writeToken(service, refreshToken);
  await updateGoogleRow(service, { connected: true, connected_at: new Date().toISOString(), disconnected_at: null });
  return "connected";
}

const DEAD_TOKEN_CODES = new Set(["invalid_token", "invalid_grant"]);

/** Revokes the token at Google, then blanks Vault and marks Google disconnected; the calendar id stays for a later reconnect. */
export async function disconnectFromGoogle(service: SupabaseClient, fetchFn: FetchFn): Promise<void> {
  const token = await readToken(service);
  if (token) {
    const res = await postForm(fetchFn, REVOKE_URL, { token });
    if (!res.ok) {
      const code = await errorCode(res);
      // Only these codes mean Google already considers the token dead, which is the goal.
      if (!(res.status === 400 && code !== null && DEAD_TOKEN_CODES.has(code))) throw new GoogleError("revoke", res.status, code);
    }
  }
  await writeToken(service, "");
  await updateGoogleRow(service, { connected: false, disconnected_at: new Date().toISOString() });
}

export type GoogleAccess = { calendar: GoogleCalendar; calendarId: string };

/** Calendar client and the Ideas calendar id for one job run (one access token, memory only); null when keys are unset. */
export async function googleFromVault(service: SupabaseClient, fetchFn: FetchFn): Promise<GoogleAccess | "disconnected" | null> {
  const config = googleConfig();
  if (!config) return null;
  const row = await readGoogleRow(service);
  if (!row.connected || !row.calendar_id) return "disconnected";
  const refreshToken = await readToken(service);
  if (!refreshToken) return "disconnected";
  const calendarId = row.calendar_id;

  let accessToken: Promise<string> | null = null;
  const access = () => (accessToken ??= refreshAccessToken(refreshToken, config, fetchFn));

  const calendar: GoogleCalendar = {
    async insertEvent(calendarId, ev) {
      const created = await calendarCall(fetchFn, "event insert", await access(), "POST", eventsUrl(calendarId), ev);
      if (typeof created.id !== "string") throw new GoogleError("event insert", 200, "no_event_id");
      return created.id;
    },
    async patchEvent(calendarId, eventId, patch) {
      await calendarCall(fetchFn, "event patch", await access(), "PATCH", eventsUrl(calendarId, eventId), patch);
    },
  };
  return { calendar, calendarId };
}
