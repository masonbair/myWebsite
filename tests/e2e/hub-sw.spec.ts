import { expect, test } from "@playwright/test";
import { HUB_LIVE_PORT, HUB_PORT } from "./hub-ports";
import { seededOwner, signInAs, supabase } from "./hub-session";

// Only the hub-live server sets NEXT_PUBLIC_HUB_SW=1, so these specs opt in by using it.
const SW_BASE = `http://localhost:${HUB_LIVE_PORT}`;

test.describe("hub service worker", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");
  test.slow();

  test.beforeEach(async ({ context }) => {
    await signInAs(context, await seededOwner());
  });

  test("registers for /hub/ and opens capture offline", async ({ page, context }) => {
    await page.goto(`${SW_BASE}/hub/capture`);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${SW_BASE}/hub/`);
    await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/hub/capture")))).toBe(true);

    await context.setOffline(true);
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    // Only the form is checked: the dev server's hot-reload script has a new name on every load, so offline it never runs here.
    await expect(page.getByRole("textbox", { name: "Capture" })).toBeVisible();
  });

  test("keeps the plain capture page as the offline copy and drops old build files it no longer names", async ({ page }) => {
    const stale = "/_next/static/chunks/old-deploy-e2e.js";
    await page.goto(`${SW_BASE}/hub/capture`);
    await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/hub/capture")))).toBe(true);
    await page.reload();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    const fresh = "/_next/static/chunks/fetched-after-html-e2e.js";
    await page.evaluate(
      async ([stalePath, freshPath]) => {
        const cache = await caches.open("hub-v1");
        await cache.put(stalePath, new Response("// old build", { headers: { "content-type": "text/javascript" } }));
        const justNow = { "content-type": "text/javascript", "x-hub-cached-at": String(Date.now()) };
        await cache.put(freshPath, new Response("// loaded by code", { headers: justNow }));
        await cache.delete("/hub/capture");
      },
      [stale, fresh],
    );

    await page.goto(`${SW_BASE}/hub/capture?share=empty`);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(async () => Boolean(await caches.match("/hub/capture")))).toBe(false);

    await page.goto(`${SW_BASE}/hub/capture`);
    await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/hub/capture")))).toBe(true);
    await expect.poll(() => page.evaluate(async (path) => Boolean(await caches.match(path)), stale)).toBe(false);
    expect(await page.evaluate(async (path) => Boolean(await caches.match(path)), fresh)).toBe(true);
  });

  test("serves the worker script publicly as no-cache JavaScript", async ({ request }) => {
    const response = await request.get(`${SW_BASE}/hub/sw.js`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(response.headers()["cache-control"]).toBe("no-cache");
  });

  test("registers on the signed-out login page, so the hub can be installed before signing in", async ({ browser }) => {
    const signedOut = await browser.newContext();
    const page = await signedOut.newPage();
    await page.goto(`${SW_BASE}/hub/login`);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${SW_BASE}/hub/`);
    await signedOut.close();
  });

  test("the default hub server registers no worker", async ({ page }) => {
    await page.goto(`http://localhost:${HUB_PORT}/hub/capture`);
    await expect(page.getByRole("textbox", { name: "Capture" })).toBeFocused();
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  });
});
