import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

const animationName = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);

test("lower tiles swing in on scroll", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const supported = await page.evaluate(() => CSS.supports("animation-timeline: view()"));
  expect(await animationName(page, ".reveal")).toBe(supported ? "swing-in" : "fade-up");
});

test("swing is off with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixtureUrl("full"));
  expect(await animationName(page, ".reveal")).toBe("none");
});

test("first-screen tiles never animate", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const name = await page
    .getByRole("heading", { name: "Hey! I'm Mason." })
    .evaluate((el) => getComputedStyle(el.closest("[data-board-grid] > *")!).animationName);
  expect(name).toBe("none");
});
