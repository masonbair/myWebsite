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

test("cat label never covers reading text on phones", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout only");
  await page.goto(fixtureUrl("full"));
  const label = page.getByText("Play with me", { exact: true });
  await expect(label).toBeVisible({ timeout: 15_000 });
  await page.getByRole("heading", { name: "Work and experience", exact: true }).scrollIntoViewIfNeeded();
  await expect(label).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(label).toBeVisible();
});

test("coffee chat cards fill the width with no empty cell", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop layout");
  await page.goto(`${fixtureUrl("full")}coffee`);
  const section = page.getByRole("region", { name: "Some chats I'm hoping for" });
  const cards = section.locator("article");
  const main = (await page.locator("main").boundingBox())!;
  const grid = (await cards.first().locator("..").boundingBox())!;
  expect(grid.width).toBeGreaterThan(main.width * 0.85);
  const tops = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  // Every row is full: the cards share one row.
  expect(new Set(tops).size).toBe(1);
});

test("header plate carries the page's fixed sun wash, so it shows no seam", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const style = await page.locator("[data-nav-plate]").evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, attachment: s.backgroundAttachment, color: s.backgroundColor };
  });
  expect(style.image).toContain("linear-gradient");
  expect(style.attachment).toContain("fixed");
  expect(style.color).toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
});

test("header plate never blocks clicks", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const pe = await page.locator("[data-nav-plate]").evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pe).toBe("none");
});
