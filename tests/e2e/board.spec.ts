import { expect, test } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

test("full board shows location", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  await expect(page.getByText("Lisbon, Portugal")).toBeVisible();
});

test("private place hides city", async ({ page, request }) => {
  await page.goto(fixtureUrl("private"));
  await expect(page.getByText("Ohio, United States")).toBeVisible();
  // Raw response, so the RSC payload is checked too.
  const html = await (await request.get(fixtureUrl("private"))).text();
  expect(html).not.toContain("Ravenna");
});

test("html never contains lat", async ({ page, request }) => {
  await page.goto(fixtureUrl("coords"));
  await expect(page.getByText("Porto, Portugal")).toBeVisible();
  const html = await (await request.get(fixtureUrl("coords"))).text();
  expect(html).not.toContain('"lat"');
  expect(html).not.toContain("lat:");
  expect(html).not.toContain("41.1579");
});

test("board renders when github is null", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const link = page.getByRole("link", { name: "See what I'm building" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://github.com/masonbair");
});

test("empty photos shows fallback", async ({ page }) => {
  await page.goto(fixtureUrl("empty"));
  const img = page.locator('img[src*="Mason_traveling"]').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("no empty grid cells", async ({ page }) => {
  await page.goto(fixtureUrl("empty"));
  const cells = await page.locator("[data-board-grid] > *").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).innerText.trim().length > 0 || el.querySelector("img") !== null),
  );
  expect(cells.length).toBeGreaterThan(0);
  expect(cells.every(Boolean)).toBe(true);
});

test("mobile has no horizontal scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone width only");
  await page.goto(fixtureUrl("full"));
  await expect(page.getByRole("heading", { name: "Hi, I'm Mason." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("hello visible without scroll", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Hi, I'm Mason." });
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test.describe("without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("hello shows without javascript", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Hi, I'm Mason." });
    await expect(heading).toBeVisible();
    // toBeVisible ignores opacity, so multiply it up the tree to catch a fade that never finishes.
    await expect
      .poll(() =>
        heading.evaluate((el) => {
          let opacity = 1;
          for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
          return opacity;
        }),
      )
      .toBe(1);
  });
});

test("github tile shows the total and never ships a private repo name", async ({ page, request }) => {
  await page.goto(fixtureUrl("github"));
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("contributions", { exact: true })).toBeVisible();
  await expect(page.getByText("public commits across")).toBeVisible();
  const html = await (await request.get(fixtureUrl("github"))).text();
  expect(html).not.toContain("secret-client-repo");
});
