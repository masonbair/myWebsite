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

  test("serves the worker script publicly as no-cache JavaScript", async ({ request }) => {
    const response = await request.get(`${SW_BASE}/hub/sw.js`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(response.headers()["cache-control"]).toBe("no-cache");
  });

  test("the default hub server registers no worker", async ({ page }) => {
    await page.goto(`http://localhost:${HUB_PORT}/hub/capture`);
    await expect(page.getByRole("textbox", { name: "Capture" })).toBeFocused();
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  });
});
