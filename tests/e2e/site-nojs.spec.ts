import { expect, test, type Locator } from "@playwright/test";

// Chromium's own setting, because Playwright's javaScriptEnabled: false does not behave like a browser with scripts off.
test.use({ launchOptions: { args: ["--blink-settings=scriptEnabled=false"] } });

// toBeVisible() counts opacity 0 as visible, so check what the eye sees: the element and every ancestor.
const shownOpacity = (locator: Locator) =>
  locator.evaluate((el) => {
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  });

test("home shows its headings and photo tile without JavaScript", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Hi, I'm Mason.", "About me", "Work and experience", "Résumé", "Contact"]) {
    const heading = page.getByRole("heading", { name, exact: true });
    await expect(heading).toBeVisible();
    await expect.poll(() => shownOpacity(heading)).toBe(1);
  }
  const tile = page.getByRole("group", { name: "Photo slideshow" }).getByRole("img").first();
  await expect(tile).toBeVisible();
  await expect.poll(() => shownOpacity(tile)).toBe(1);
});

test("coffee page shows its headings without JavaScript", async ({ page }) => {
  await page.goto("/coffee");
  for (const name of ["Coffee chat with Mason Bair", "What we can talk about", "Who usually books", "Book by email instead", "Questions"]) {
    const heading = page.getByRole("heading", { name, exact: true });
    await expect(heading).toBeVisible();
    await expect.poll(() => shownOpacity(heading)).toBe(1);
  }
});
