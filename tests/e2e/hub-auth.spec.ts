import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseEnv } from "./local-supabase";

// Runs only in the "hub" project, whose server points at local Supabase (playwright.config.ts).

test("signed out, /hub sends you to the login page", async ({ page }) => {
  await page.goto("/hub");
  await expect(page).toHaveURL(/\/hub\/login$/);
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
});

test("signed out, a deeper hub page also sends you to the login page", async ({ request }) => {
  const res = await request.get("/hub/anything", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers().location, "http://x").pathname).toBe("/hub/login");
});

test("hub api without a token answers 401", async ({ request }) => {
  const res = await request.get("/api/hub/worker/inbox");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  const notBearer = await request.get("/api/hub/worker/inbox", { headers: { authorization: "Basic abc" } });
  expect(notBearer.status()).toBe(401);
});

test("hub pages tell search engines not to index them", async ({ request }) => {
  for (const path of ["/hub", "/hub/login"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.headers()["x-robots-tag"], path).toContain("noindex");
  }
  const login = await (await request.get("/hub/login")).text();
  expect(login).toMatch(/<meta name="robots" content="noindex/);
});

test("the sitemap does not list the hub", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("<urlset");
  expect(sitemap).not.toContain("/hub");
});

test("public pages and the leaderboard api are not gated", async ({ request }) => {
  expect((await request.get("/", { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get("/coffee", { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get("/api/leaderboard", { maxRedirects: 0 })).status()).not.toBe(401);
});

test.describe("signed in", () => {
  const supabase = localSupabaseEnv();
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = () => createClient(supabase.url, supabase.serviceKey, noPersist);

  async function newUser() {
    const email = `hub-e2e-${randomUUID()}@example.test`;
    const password = randomUUID();
    const { data, error } = await service().auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    return { id: data.user.id, email, password };
  }

  // Signs in the way the browser would and hands the resulting session cookies to the page.
  async function signInAs(context: BrowserContext, user: { email: string; password: string }) {
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

  test("Mason's GitHub account sees the hub", async ({ page, context }) => {
    const owner = await newUser();
    // Local Supabase has no GitHub OAuth, so link the identity the real callback would have.
    execSync(
      `docker exec -i supabase_db_masonbair psql -U postgres -v ON_ERROR_STOP=1 -c "insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at) values ('77211262', '${owner.id}', '{\\"sub\\":\\"77211262\\"}', 'github', now(), now(), now()) on conflict (provider_id, provider) do update set user_id = excluded.user_id, created_at = now(), updated_at = now(), last_sign_in_at = now()"`,
      { stdio: "ignore" },
    );
    const { error } = await service().from("hub_owner").insert({ user_id: owner.id });
    expect(error).toBeNull();
    await signInAs(context, owner);
    const res = await page.goto("/hub");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/hub$/);
    await expect(page.getByText("You are signed in.")).toBeVisible();
  });

  test("anyone else signed in gets a 404", async ({ page, context }) => {
    await signInAs(context, await newUser());
    const res = await page.goto("/hub");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("You are signed in.")).toHaveCount(0);
  });
});

test("a dead session cookie is cleared on the way to the login page", async ({ request }) => {
  const supabase = localSupabaseEnv();
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");
  const cookieName = `sb-${new URL(supabase.url).hostname.split(".")[0]}-auth-token`;
  const deadSession = {
    access_token: "not-a-jwt",
    refresh_token: "no-such-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1,
    user: { id: "00000000-0000-0000-0000-000000000000" },
  };
  const value = `base64-${Buffer.from(JSON.stringify(deadSession)).toString("base64url")}`;
  const res = await request.get("/hub", { maxRedirects: 0, headers: { cookie: `${cookieName}=${value}` } });
  expect(res.status()).toBe(307);
  const cleared = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(`${cookieName}=`));
  expect(cleared.length).toBeGreaterThan(0);
  cleared.forEach((h) => expect(h.value).toMatch(/Max-Age=0/i));
});
