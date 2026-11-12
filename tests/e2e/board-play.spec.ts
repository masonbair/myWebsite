import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

const ready = (page: Page) => expect(page.locator("html[data-board-motion=ready]")).toHaveCount(1, { timeout: 15_000 });
const stamp = (page: Page) => page.locator("[data-stamp]");

test.describe("terminal tile", () => {
  const input = (page: Page) => page.getByLabel("Type a command");
  const run = async (page: Page, cmd: string) => {
    await input(page).fill(cmd);
    await input(page).press("Enter");
  };

  test("answers whereami from what the board shows", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await run(page, "whereami");
    await expect(page.getByRole("log")).toContainText("Lisbon, Portugal. 22 countries so far.");
  });

  test("clear wipes the screen", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await run(page, "help");
    await expect(page.getByRole("log")).toContainText("whereami");
    await run(page, "clear");
    await expect(page.getByRole("log")).toHaveText("");
  });

  test("never says more than the board for a private place", async ({ page, request }) => {
    await page.goto(fixtureUrl("private"));
    await run(page, "whereami");
    await expect(page.getByRole("log")).toContainText("Ohio, United States");
    await expect(page.getByRole("log")).not.toContainText("Testerville");
    const html = await (await request.get(fixtureUrl("private"))).text();
    expect(html).not.toContain("Testerville");
  });

  test("the board stays at 8 tiles or fewer with no holes", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    expect(await page.locator("[data-board-grid] > *").count()).toBeLessThanOrEqual(8);
    await expect(page.locator('[data-tile="terminal"]')).toBeVisible();
  });
});

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
