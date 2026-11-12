import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

const ready = (page: Page) => expect(page.locator("html[data-board-motion=ready]")).toHaveCount(1, { timeout: 15_000 });
const stamp = (page: Page) => page.locator("[data-stamp]");

test.describe("passport stamp", () => {
  test("stamp is visible before any motion loads", async ({ page }) => {
    await page.goto(fixtureUrl("full"), { waitUntil: "commit" });
    await expect(stamp(page)).toBeVisible();
    expect(await stamp(page).evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("stamp thumps down once motion loads", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    expect(await stamp(page).evaluate((el) => getComputedStyle(el).animationName)).toBe("stamp-land");
  });

  test("stamp holds still with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(fixtureUrl("full"));
    await ready(page);
    expect(await stamp(page).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await expect(stamp(page)).toBeVisible();
  });
});
