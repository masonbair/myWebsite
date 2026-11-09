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
    // The sticker dark canvas is #15142a, so its blue channel is 42.
    expect(Math.max(r, g, b)).toBeLessThan(48);
  });
});

test("mobile menu opens and closes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "menu button only shows below 1024px");
  await page.goto("/");
  const resume = page.getByRole("link", { name: "Résumé", exact: true });
  await expect(resume).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(resume).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(page.locator("main")).toHaveJSProperty("inert", true);
  await page.keyboard.press("Escape");
  await expect(resume).toBeHidden();
  await expect(page.locator("main")).toHaveJSProperty("inert", false);
});

test("no em dashes", async ({ page }) => {
  await page.goto("/");
  const text = await page.evaluate(
    () => document.body.innerText + document.title + (document.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""),
  );
  expect(text).not.toContain("—");
  expect(text).not.toContain("–");
});

// Tailwind v4's outline-none zeroes the outline style that focus-visible:outline-2 reads, so a ring can be set and still never draw.
test("keyboard focus draws a visible outline", async ({ page }) => {
  await page.goto("/coffee");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement!);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), tag: document.activeElement!.tagName };
    });
    if (ring.tag === "BODY") continue;
    expect(ring.style, `focus ring on tab stop ${i + 1}`).not.toBe("none");
    expect(ring.width).toBeGreaterThanOrEqual(2);
  }
});
