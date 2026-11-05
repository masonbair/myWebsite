import { expect, test, type Page } from "@playwright/test";
import { newUser, seededOwner, signInAs } from "./hub-session";

// Mason's phone browser can run with JavaScript off. Playwright's javaScriptEnabled: false still parses <noscript>
// as if scripts ran, so Chromium's own setting is used to behave like a real browser with JavaScript off.
test.use({ launchOptions: { args: ["--blink-settings=scriptEnabled=false"] } });

const NOTICE = "This page needs JavaScript. Turn it on for masonbair.com in your browser settings.";

async function expectPage(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  // getByText skips <noscript>, so the notice is found by CSS.
  const notice = page.locator("noscript p");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(NOTICE);
}

test("signed out, /hub/login shows its heading and the JavaScript notice", async ({ page }) => {
  await expectPage(page, "/hub/login", "Sign in");
});

test("signed in as Mason, /hub/capture shows its heading and the JavaScript notice", async ({ page, context }) => {
  await signInAs(context, await seededOwner());
  await expectPage(page, "/hub/capture", "Capture");
});

test("signed in as Mason, an unknown item shows the 404 page, not a blank one", async ({ page, context }) => {
  await signInAs(context, await seededOwner());
  const res = await page.goto("/hub/item/00000000-0000-4000-8000-000000000999");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("signed in as someone else, the hub answers 404 with a visible message, not a blank page", async ({ page, context }) => {
  await signInAs(context, await newUser());
  const res = await page.goto("/hub/capture");
  expect(res?.status()).toBe(404);
  expect(page.url()).toMatch(/\/hub\/missing$/);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
