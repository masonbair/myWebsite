import { expect, test } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

test("header plate hides text scrolling under the nav", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const heading = page.getByRole("heading", { name: "Work and experience", exact: true });
  await heading.scrollIntoViewIfNeeded();
  // Put the heading right under the nav, where it used to show through.
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((el) => el.textContent?.trim() === "Work and experience")!;
    window.scrollBy(0, h.getBoundingClientRect().top - 20);
  });
  const hit = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((el) => el.textContent?.trim() === "Work and experience")!;
    const r = h.getBoundingClientRect();
    const plate = document.querySelector("[data-nav-plate]");
    if (!plate) return "no plate";
    const p = plate.getBoundingClientRect();
    const bg = getComputedStyle(plate).backgroundColor;
    return r.top >= p.top && r.top < p.bottom && bg !== "rgba(0, 0, 0, 0)" ? "covered" : `uncovered ${bg}`;
  });
  expect(hit).toBe("covered");
});

test("header plate never blocks clicks", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const pe = await page.locator("[data-nav-plate]").evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pe).toBe("none");
});
