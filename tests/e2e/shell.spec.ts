import { expect, test, type Page } from "@playwright/test";

test("nav is one line at 1024", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  const box = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeLessThanOrEqual(72);
});

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("light", () => {
  test.use({ colorScheme: "light" });

  test("light mode uses the brand canvas", async ({ page }) => {
    await page.goto("/");
    expect(await bodyBackground(page)).toBe("rgb(247, 246, 253)");
  });
});

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("dark mode uses dark canvas", async ({ page }) => {
    await page.goto("/");
    const bg = await bodyBackground(page);
    expect(bg).not.toBe("rgb(247, 246, 253)");
    const [r, g, b, a = 1] = bg.match(/[\d.]+/g)!.map(Number);
    expect(a).toBe(1);
    expect(Math.max(r, g, b)).toBeLessThan(40);
  });
});

test("mobile menu opens and closes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "menu button only shows below 768px");
  await page.goto("/");
  const resume = page.getByRole("link", { name: "Résumé" });
  await expect(resume).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(resume).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(resume).toBeHidden();
});

test("no em dashes", async ({ page }) => {
  await page.goto("/");
  const text = await page.evaluate(
    () => document.body.innerText + document.title + (document.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""),
  );
  expect(text).not.toContain("—");
  expect(text).not.toContain("–");
});
