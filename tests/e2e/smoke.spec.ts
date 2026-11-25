import { expect, test } from "@playwright/test";

test("resume pdf is served at its old url", async ({ request }) => {
  const res = await request.get("/misc/mason-bair-resume.pdf");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("pdf");
});

test("home renders", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator("main")).toHaveCount(1);
});
