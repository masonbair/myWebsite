import { expect, test } from "@playwright/test";
import { newUser, seededOwner, signInAs, supabase } from "./hub-session";

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
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test("Mason's GitHub account sees the hub", async ({ page, context }) => {
    const owner = await seededOwner();
    await signInAs(context, owner);
    const res = await page.goto("/hub");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/hub$/);
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  });

  test("anyone else signed in gets a 404", async ({ page, context }) => {
    await signInAs(context, await newUser());
    const res = await page.goto("/hub");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Inbox" })).toHaveCount(0);
  });
});

test("a dead session cookie is cleared on the way to the login page", async ({ request }) => {
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
