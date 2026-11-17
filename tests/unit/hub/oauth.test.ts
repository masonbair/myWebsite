import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accessTokenValid,
  checkAuthorize,
  exchange,
  type Grant,
  type GrantStore,
  issueCode,
  OAuthError,
  register,
  requestFromCookie,
} from "@/lib/hub/oauth";

const ORIGIN = "https://hub.test";
const RESOURCE = `${ORIGIN}/api/mcp/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const T0 = new Date("2026-11-17T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

function memoryStore() {
  const grants = new Map<string, Grant>();
  const store: GrantStore = {
    insert: async (g) => void grants.set(g.id, { ...g }),
    get: async (id) => (grants.has(id) ? { ...grants.get(id)! } : null),
    swap: async (id, kind, expected, next) => {
      const g = grants.get(id);
      if (!g || g.revokedAt || (kind === "code" ? g.codeHash : g.refreshHash) !== expected) return false;
      grants.set(id, { ...g, ...next });
      return true;
    },
    revoke: async (id) => {
      const g = grants.get(id);
      if (g) g.revokedAt = T0;
    },
  };
  return { grants, store };
}

const pending = { redirectUri: CALLBACK, codeChallenge: CHALLENGE, state: "s1", resource: RESOURCE };
const codeForm = (code: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: CALLBACK, client_id: "claude-ai", resource: RESOURCE, ...extra });
const refreshForm = (token: string) => new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: "claude-ai" });

async function signedIn() {
  const env = memoryStore();
  const code = await issueCode(env.store, pending, T0);
  const tokens = await exchange(env.store, codeForm(code), ORIGIN, T0);
  return { ...env, code, tokens };
}

async function expectGrantError(work: Promise<unknown>, code = "invalid_grant") {
  await expect(work).rejects.toSatisfy((e) => e instanceof OAuthError && e.code === code);
}

describe("hub oauth", () => {
  it("registration only accepts the claude.ai callback", () => {
    expect(register({ redirect_uris: [CALLBACK] }).client_id).toBe("claude-ai");
    expect(() => register({ redirect_uris: ["https://evil.test/cb"] })).toThrow(OAuthError);
    expect(() => register({ redirect_uris: [CALLBACK, "https://evil.test/cb"] })).toThrow(OAuthError);
    expect(() => register({})).toThrow(OAuthError);
  });

  it("authorize never redirects to an unknown site and requires S256 PKCE", () => {
    const params = (extra: Record<string, string>) =>
      new URLSearchParams({ client_id: "claude-ai", response_type: "code", redirect_uri: CALLBACK, code_challenge: CHALLENGE, code_challenge_method: "S256", ...extra });
    expect(checkAuthorize(params({ state: "x" }), ORIGIN)).toEqual({ ...pending, state: "x" });
    expect(() => checkAuthorize(params({ redirect_uri: "https://evil.test/cb" }), ORIGIN)).toThrow(OAuthError);
    expect(() => checkAuthorize(params({ client_id: "other" }), ORIGIN)).toThrow(OAuthError);
    expect(checkAuthorize(params({ code_challenge_method: "plain" }), ORIGIN)).toMatchObject({ redirectError: "invalid_request" });
    expect(checkAuthorize(params({ resource: "https://other.test/api/mcp/mcp" }), ORIGIN)).toMatchObject({ redirectError: "invalid_target" });
  });

  it("a tampered request cookie is rejected", () => {
    expect(requestFromCookie(JSON.stringify(pending), ORIGIN)).toEqual(pending);
    expect(requestFromCookie(JSON.stringify({ ...pending, redirectUri: "https://evil.test/cb" }), ORIGIN)).toBeNull();
    expect(requestFromCookie("not json", ORIGIN)).toBeNull();
    expect(requestFromCookie(undefined, ORIGIN)).toBeNull();
  });

  it("code plus the right verifier gives an access token that works only on this deploy", async () => {
    const { store, tokens } = await signedIn();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "hub" });
    expect(await accessTokenValid(store, tokens.access_token, ORIGIN, T0)).toBe(true);
    expect(await accessTokenValid(store, tokens.access_token, "https://preview.test", T0)).toBe(false);
    expect(await accessTokenValid(store, tokens.access_token, ORIGIN, later(3600_000))).toBe(false);
    expect(await accessTokenValid(store, tokens.refresh_token, ORIGIN, T0)).toBe(false);
  });

  it("a wrong PKCE verifier or redirect is refused", async () => {
    const { store } = memoryStore();
    const code = await issueCode(store, pending, T0);
    await expectGrantError(exchange(store, codeForm(code, { code_verifier: "b".repeat(64) }), ORIGIN, T0));
    const code2 = await issueCode(store, pending, T0);
    await expectGrantError(exchange(store, codeForm(code2, { redirect_uri: "https://evil.test/cb" }), ORIGIN, T0));
  });

  it("a code expires after five minutes", async () => {
    const { store } = memoryStore();
    const code = await issueCode(store, pending, T0);
    await expectGrantError(exchange(store, codeForm(code), ORIGIN, later(5 * 60_000 + 1)));
  });

  it("using a code twice ends the sign-in", async () => {
    const { store, code, tokens } = await signedIn();
    await expectGrantError(exchange(store, codeForm(code), ORIGIN, T0));
    expect(await accessTokenValid(store, tokens.access_token, ORIGIN, T0)).toBe(false);
  });

  it("refresh gives new tokens, and reusing an old refresh token ends the sign-in", async () => {
    const { store, tokens } = await signedIn();
    const next = await exchange(store, refreshForm(tokens.refresh_token), ORIGIN, later(60_000));
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(await accessTokenValid(store, tokens.access_token, ORIGIN, later(60_000))).toBe(false);
    expect(await accessTokenValid(store, next.access_token, ORIGIN, later(60_000))).toBe(true);
    await expectGrantError(exchange(store, refreshForm(tokens.refresh_token), ORIGIN, later(120_000)));
    expect(await accessTokenValid(store, next.access_token, ORIGIN, later(120_000))).toBe(false);
    await expectGrantError(exchange(store, refreshForm(next.refresh_token), ORIGIN, later(120_000)));
  });

  it("a revoked grant stops working at once", async () => {
    const { store, grants, tokens } = await signedIn();
    grants.forEach((g) => (g.revokedAt = T0));
    expect(await accessTokenValid(store, tokens.access_token, ORIGIN, T0)).toBe(false);
    await expectGrantError(exchange(store, refreshForm(tokens.refresh_token), ORIGIN, T0));
  });

  it("garbage tokens and unknown grant types are refused", async () => {
    const { store } = memoryStore();
    expect(await accessTokenValid(store, "huba_nope", ORIGIN, T0)).toBe(false);
    await expectGrantError(exchange(store, refreshForm("hubr_x"), ORIGIN, T0));
    await expectGrantError(exchange(store, new URLSearchParams({ grant_type: "password" }), ORIGIN, T0), "unsupported_grant_type");
  });
});
