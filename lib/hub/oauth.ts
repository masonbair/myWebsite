import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/** The only place a code may be sent: claude.ai's connector callback, which its web, desktop and phone apps all use. */
export const ALLOWED_REDIRECTS = new Set(["https://claude.ai/api/mcp/auth_callback"]);
export const CLIENT_ID = "claude-ai";
export const SCOPE = "hub";
export const MCP_PATH = "/api/mcp/mcp";
export const REQUEST_COOKIE = "hub_oauth_request";

const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
// A PKCE S256 challenge is the base64url of a SHA-256 digest: exactly 43 characters.
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const MAX_STATE = 1024;

export type TokenKind = "code" | "access" | "refresh";
const PREFIX: Record<TokenKind, string> = { code: "hubc", access: "huba", refresh: "hubr" };

export type Grant = {
  id: string;
  resource: string;
  redirectUri: string;
  codeChallenge: string;
  codeHash: string | null;
  codeExpiresAt: Date | null;
  accessHash: string | null;
  accessExpiresAt: Date | null;
  refreshHash: string | null;
  refreshExpiresAt: Date | null;
  revokedAt: Date | null;
};

export type GrantSecrets = Pick<Grant, "codeHash" | "codeExpiresAt" | "accessHash" | "accessExpiresAt" | "refreshHash" | "refreshExpiresAt">;

export interface GrantStore {
  insert(grant: Grant): Promise<void>;
  get(id: string): Promise<Grant | null>;
  /** Writes `next` only while the column for `kind` still holds `expectedHash`; false when another request got there first. */
  swap(id: string, kind: "code" | "refresh", expectedHash: string, next: GrantSecrets): Promise<boolean>;
  revoke(id: string): Promise<void>;
}

export type AuthorizeRequest = { redirectUri: string; codeChallenge: string; state: string | null; resource: string };

export class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

/** The MCP endpoint's own URL on this deploy; tokens are bound to it so a preview's tokens never work in production. */
export function resourceFor(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceFor(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Mason's hub",
  };
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

/** The 401 header that tells an MCP client where to start signing in. */
export function challengeHeader(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}", scope="${SCOPE}"`;
}

/** Dynamic client registration: every redirect must be on the allow list, and nothing is stored. */
export function register(body: unknown) {
  const uris = (body as { redirect_uris?: unknown } | null)?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === "string" && ALLOWED_REDIRECTS.has(u))) {
    throw new OAuthError("invalid_redirect_uri", "only the claude.ai connector callback is allowed");
  }
  return {
    client_id: CLIENT_ID,
    client_name: "Claude",
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPE,
  };
}

/** Checks an authorize request; a bad client or redirect throws instead of redirecting, so nothing goes to an unknown site. */
export function checkAuthorize(params: URLSearchParams, origin: string): AuthorizeRequest | { redirectUri: string; state: string | null; redirectError: string } {
  const redirectUri = params.get("redirect_uri") ?? "";
  if (params.get("client_id") !== CLIENT_ID) throw new OAuthError("invalid_client", "unknown client");
  if (!ALLOWED_REDIRECTS.has(redirectUri)) throw new OAuthError("invalid_request", "redirect_uri is not allowed");
  const state = params.get("state");
  if (state !== null && state.length > MAX_STATE) throw new OAuthError("invalid_request", "state is too long");
  const fail = (redirectError: string) => ({ redirectUri, state, redirectError });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !CHALLENGE.test(challenge)) return fail("invalid_request");
  const resource = params.get("resource") ?? resourceFor(origin);
  if (resource !== resourceFor(origin)) return fail("invalid_target");
  const scope = params.get("scope");
  if (scope !== null && scope.split(" ").some((s) => s !== "" && s !== SCOPE)) return fail("invalid_scope");
  return { redirectUri, codeChallenge: challenge, state, resource };
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameHash(a: string, b: string | null): boolean {
  return b !== null && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function mint(kind: TokenKind, grantId: string): string {
  return `${PREFIX[kind]}_${grantId}_${randomBytes(32).toString("base64url")}`;
}

/** The grant id inside a token of `kind`, or null when the token is not one. */
export function grantIdOf(token: string, kind: TokenKind): string | null {
  const match = token.match(new RegExp(`^${PREFIX[kind]}_([0-9a-f-]{36})_[A-Za-z0-9_-]{43}$`));
  return match?.[1] ?? null;
}

/** Starts a grant after Mason clicks Allow; returns the one-time code. */
export async function issueCode(store: GrantStore, request: AuthorizeRequest, now: Date): Promise<string> {
  const id = randomUUID();
  const code = mint("code", id);
  await store.insert({
    id,
    resource: request.resource,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    codeHash: hash(code),
    codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS),
    accessHash: null,
    accessExpiresAt: null,
    refreshHash: null,
    refreshExpiresAt: null,
    revokedAt: null,
  });
  return code;
}

function freshTokens(id: string, now: Date) {
  const access = mint("access", id);
  const refresh = mint("refresh", id);
  const secrets: GrantSecrets = {
    codeHash: null,
    codeExpiresAt: null,
    accessHash: hash(access),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_S * 1000),
    refreshHash: hash(refresh),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  };
  const body = { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
  return { secrets, body };
}

const invalidGrant = () => new OAuthError("invalid_grant", "the code or refresh token is not valid");

/** Swaps a token for new ones. A token used twice ends the whole grant, since one copy must be stolen. */
async function rotate(store: GrantStore, kind: "code" | "refresh", token: string, now: Date, check: (grant: Grant) => void) {
  const id = grantIdOf(token, kind);
  if (!id) throw invalidGrant();
  const grant = await store.get(id);
  if (!grant || grant.revokedAt) throw invalidGrant();
  const current = kind === "code" ? grant.codeHash : grant.refreshHash;
  const expires = kind === "code" ? grant.codeExpiresAt : grant.refreshExpiresAt;
  const presented = hash(token);
  if (!sameHash(presented, current)) {
    await store.revoke(id);
    throw invalidGrant();
  }
  if (!expires || expires <= now) throw invalidGrant();
  check(grant);
  const { secrets, body } = freshTokens(id, now);
  if (!(await store.swap(id, kind, presented, secrets))) {
    await store.revoke(id);
    throw invalidGrant();
  }
  return body;
}

function pkceMatches(verifier: string, challenge: string): boolean {
  return VERIFIER.test(verifier) && createHash("sha256").update(verifier).digest("base64url") === challenge;
}

/** The token endpoint: authorization_code (with PKCE) or refresh_token. */
export async function exchange(store: GrantStore, form: URLSearchParams, origin: string, now: Date) {
  const resource = form.get("resource");
  if (resource !== null && resource !== resourceFor(origin)) throw new OAuthError("invalid_target", "wrong resource");
  const clientId = form.get("client_id");
  if (clientId !== null && clientId !== CLIENT_ID) throw new OAuthError("invalid_client", "unknown client", 401);
  const sameResource = (grant: Grant) => {
    if (grant.resource !== resourceFor(origin)) throw invalidGrant();
  };
  switch (form.get("grant_type")) {
    case "authorization_code":
      return rotate(store, "code", form.get("code") ?? "", now, (grant) => {
        sameResource(grant);
        if (form.get("redirect_uri") !== grant.redirectUri) throw invalidGrant();
        if (!pkceMatches(form.get("code_verifier") ?? "", grant.codeChallenge)) throw invalidGrant();
      });
    case "refresh_token":
      return rotate(store, "refresh", form.get("refresh_token") ?? "", now, sameResource);
    default:
      throw new OAuthError("unsupported_grant_type", "use authorization_code or refresh_token");
  }
}

/** True when `token` is a live access token for this deploy's MCP endpoint. */
export async function accessTokenValid(store: GrantStore, token: string, origin: string, now: Date): Promise<boolean> {
  const id = grantIdOf(token, "access");
  if (!id) return false;
  const grant = await store.get(id);
  if (!grant || grant.revokedAt || grant.resource !== resourceFor(origin)) return false;
  if (!grant.accessExpiresAt || grant.accessExpiresAt <= now) return false;
  return sameHash(hash(token), grant.accessHash);
}

/** The waiting request from its cookie, checked again from scratch; null when missing, expired or tampered with. */
export function requestFromCookie(value: string | undefined, origin: string): AuthorizeRequest | null {
  if (!value) return null;
  try {
    const saved = JSON.parse(value) as Partial<AuthorizeRequest>;
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      code_challenge_method: "S256",
      redirect_uri: String(saved.redirectUri),
      code_challenge: String(saved.codeChallenge),
      resource: String(saved.resource),
    });
    if (typeof saved.state === "string") params.set("state", saved.state);
    const checked = checkAuthorize(params, origin);
    return "redirectError" in checked ? null : checked;
  } catch {
    return null;
  }
}

/** Where to send the browser once Mason answers. */
export function callbackUrl(request: Pick<AuthorizeRequest, "redirectUri" | "state">, origin: string, result: { code: string } | { error: string }): URL {
  const back = new URL(request.redirectUri);
  if ("code" in result) back.searchParams.set("code", result.code);
  else back.searchParams.set("error", result.error);
  if (request.state !== null) back.searchParams.set("state", request.state);
  back.searchParams.set("iss", origin);
  return back;
}
