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

const ready = (page: Page) => expect(page.locator("html[data-board-motion=ready]")).toHaveCount(1, { timeout: 15_000 });
const tileVar = (page: Page, tile: string, name: string) =>
  page.locator(`[data-tile="${tile}"]`).evaluate((el, n) => (el as HTMLElement).style.getPropertyValue(n), name);

test.describe("desktop lean", () => {
  test.skip(({ isMobile }) => isMobile, "mouse only");

  test("tile leans toward cursor", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const box = (await page.locator('[data-tile="location"]').boundingBox())!;
    await page.mouse.move(box.x + box.width - 5, box.y + 5);
    await expect.poll(() => tileVar(page, "location", "--lean-x")).toMatch(/^[1-9]/);
  });

  test("press lifts a tile", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const box = (await page.locator('[data-tile="location"]').boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height - 20);
    await page.mouse.down();
    await expect.poll(() => tileVar(page, "location", "--lift")).toBe("-4px");
    await page.mouse.up();
    await expect.poll(() => tileVar(page, "location", "--lift")).toBe("");
  });

  test("no lean with reduced motion", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const box = (await page.locator('[data-tile="location"]').boundingBox())!;
    await page.mouse.move(box.x + box.width - 5, box.y + 5);
    await page.waitForTimeout(300);
    expect(await tileVar(page, "location", "--lean-x")).toBe("");
  });
});

test.describe("dot field", () => {
  test.skip(({ isMobile }) => isMobile, "mouse only");

  test("dot field appears on desktop", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const dots = page.locator("canvas[data-dots]");
    await expect(dots).toHaveCount(1);
    await expect(dots).toHaveAttribute("aria-hidden", "true");
    expect(await dots.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  });

  test("dot field resizes", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await page.setViewportSize({ width: 900, height: 700 });
    await expect
      .poll(() =>
        page.locator("canvas[data-dots]").evaluate((el) => (el as HTMLCanvasElement).width === Math.round(innerWidth * devicePixelRatio)),
      )
      .toBe(true);
  });

  test("dot loop stops when idle", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await page.mouse.move(300, 300);
    await page.mouse.move(340, 320);
    await expect(page.locator("canvas[data-dots]")).toHaveAttribute("data-running", "true");
    await expect(page.locator("canvas[data-dots]")).toHaveAttribute("data-running", "false", { timeout: 2_000 });
  });

  test("no dot field with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await expect(page.locator("canvas[data-dots]")).toHaveCount(0);
  });
});

test.describe("touch", () => {
  test("no dot field on touch", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await expect(page.locator("canvas[data-dots]")).toHaveCount(0);
  });

  test.skip(({ isMobile }) => !isMobile, "touch only");

  test("no lean on touch, press still lifts", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const tile = page.locator('[data-tile="location"]');
    await tile.dispatchEvent("pointermove", { pointerType: "touch", clientX: 10, clientY: 10, bubbles: true });
    await tile.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
    await expect.poll(() => tileVar(page, "location", "--lift")).toBe("-4px");
    expect(await tileVar(page, "location", "--lean-x")).toBe("");
  });
});
