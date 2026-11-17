import type { SupabaseClient } from "@supabase/supabase-js";
import type { Grant, GrantSecrets, GrantStore } from "./oauth";

const TABLE = "hub_oauth_grants";

type Row = {
  id: string;
  resource: string;
  redirect_uri: string;
  code_challenge: string;
  code_hash: string | null;
  code_expires_at: string | null;
  access_hash: string | null;
  access_expires_at: string | null;
  refresh_hash: string | null;
  refresh_expires_at: string | null;
  revoked_at: string | null;
};

const date = (value: string | null) => (value === null ? null : new Date(value));
const iso = (value: Date | null) => value?.toISOString() ?? null;

function secretsRow(s: GrantSecrets) {
  return {
    code_hash: s.codeHash,
    code_expires_at: iso(s.codeExpiresAt),
    access_hash: s.accessHash,
    access_expires_at: iso(s.accessExpiresAt),
    refresh_hash: s.refreshHash,
    refresh_expires_at: iso(s.refreshExpiresAt),
  };
}

function fromRow(r: Row): Grant {
  return {
    id: r.id,
    resource: r.resource,
    redirectUri: r.redirect_uri,
    codeChallenge: r.code_challenge,
    codeHash: r.code_hash,
    codeExpiresAt: date(r.code_expires_at),
    accessHash: r.access_hash,
    accessExpiresAt: date(r.access_expires_at),
    refreshHash: r.refresh_hash,
    refreshExpiresAt: date(r.refresh_expires_at),
    revokedAt: date(r.revoked_at),
  };
}

/** @param db must be the service client: the table is closed to everyone else. */
export function supabaseGrantStore(db: SupabaseClient): GrantStore {
  return {
    async insert(g) {
      const { error } = await db.from(TABLE).insert({
        id: g.id,
        resource: g.resource,
        redirect_uri: g.redirectUri,
        code_challenge: g.codeChallenge,
        ...secretsRow(g),
        revoked_at: iso(g.revokedAt),
      });
      if (error) throw new Error(`could not save hub sign-in: ${error.message}`);
    },
    async get(id) {
      const { data, error } = await db.from(TABLE).select("*").eq("id", id).maybeSingle<Row>();
      if (error) throw new Error(`could not read hub sign-in: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async swap(id, kind, expectedHash, next) {
      const { data, error } = await db
        .from(TABLE)
        .update({ ...secretsRow(next), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq(kind === "code" ? "code_hash" : "refresh_hash", expectedHash)
        .is("revoked_at", null)
        .select("id");
      if (error) throw new Error(`could not update hub sign-in: ${error.message}`);
      return data.length === 1;
    },
    async revoke(id) {
      const { error } = await db.from(TABLE).update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
      if (error) throw new Error(`could not revoke hub sign-in: ${error.message}`);
    },
  };
}
