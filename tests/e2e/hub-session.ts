import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { dbContainer } from "./db-container";
import { localSupabaseEnv } from "./local-supabase";

export const supabase = localSupabaseEnv();

// Matches HUB_OWNER_GITHUB_ID on the hub servers in playwright.config.ts.
const OWNER_GITHUB_ID = "77211262";
// One fixed owner for every spec: linking the GitHub identity to a fresh user per spec would unlink it from the other spec's user mid-run.
const OWNER_EMAIL = "hub-e2e-owner@example.test";
const OWNER_PASSWORD = "hub-e2e-owner-local-only";

type Credentials = { id: string; email: string; password: string };

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export function serviceClient() {
  return createClient(supabase.url, supabase.serviceKey, noPersist);
}

export async function newUser(): Promise<Credentials> {
  const email = `hub-e2e-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await serviceClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

async function ownerUser(): Promise<Credentials> {
  const admin = serviceClient().auth.admin;
  const created = await admin.createUser({ email: OWNER_EMAIL, password: OWNER_PASSWORD, email_confirm: true });
  if (created.data.user) return { id: created.data.user.id, email: OWNER_EMAIL, password: OWNER_PASSWORD };
  const { data, error } = await admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existing = data.users.find((u) => u.email === OWNER_EMAIL);
  if (!existing) throw created.error ?? new Error("could not create the e2e owner");
  return { id: existing.id, email: OWNER_EMAIL, password: OWNER_PASSWORD };
}

/** Makes the fixed e2e user Mason: links the GitHub identity the real callback would have and adds the hub_owner row. */
export async function seededOwner(): Promise<Credentials> {
  const owner = await ownerUser();
  // Local Supabase has no GitHub OAuth, so the identity is written straight into auth.identities.
  execSync(
    `docker exec -i ${dbContainer(process.env, join(__dirname, "..", ".."))} psql -U postgres -v ON_ERROR_STOP=1 -c "insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at) values ('${OWNER_GITHUB_ID}', '${owner.id}', '{\\"sub\\":\\"${OWNER_GITHUB_ID}\\"}', 'github', now(), now(), now()) on conflict (provider_id, provider) do update set user_id = excluded.user_id, updated_at = now(), last_sign_in_at = now()"`,
    { stdio: "ignore" },
  );
  const { error } = await serviceClient()
    .from("hub_owner")
    .upsert({ user_id: owner.id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw error;
  return owner;
}

/** Signs in the way the browser would and hands the resulting session cookies to the context (any localhost port). */
export async function signInAs(context: BrowserContext, user: { email: string; password: string }) {
  const jar = new Map<string, string>();
  const client = createServerClient(supabase.url, supabase.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => toSet.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await client.auth.signInWithPassword(user);
  if (error) throw error;
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
}

/** A database client signed in as the e2e owner; the database takes the claude label and Mason's comments only from this role. */
export async function ownerDbClient() {
  const owner = await seededOwner();
  const client = createClient(supabase.url, supabase.anonKey, noPersist);
  const { error } = await client.auth.signInWithPassword(owner);
  if (error) throw error;
  return client;
}
