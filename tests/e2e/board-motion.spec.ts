import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

const animationName = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);

test("lower tiles swing in on scroll", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const supported = await page.evaluate(() => CSS.supports("animation-timeline: view()"));
  expect(await animationName(page, ".reveal")).toBe(supported ? "swing-in" : "fade-up");
});

test("coffee tiles swing in like the board", async ({ page }) => {
  await page.goto(`${fixtureUrl("full")}coffee`);
  const supported = await page.evaluate(() => CSS.supports("animation-timeline: view()"));
  expect(await animationName(page, "[data-coffee-grid] > .reveal")).toBe(supported ? "swing-in-solid" : "fade-up");
});

test.describe("coffee motion", () => {
  test.skip(({ isMobile }) => isMobile, "mouse only");

  test("coffee tiles lean under the mouse and the dots and colors run", async ({ page }) => {
    await page.goto(`${fixtureUrl("full")}coffee`);
    await ready(page);
    const box = (await page.locator('[data-tile="coffee-hero"]').boundingBox())!;
    await page.mouse.move(box.x + box.width - 20, box.y + 40);
    await expect.poll(() => tileVar(page, "coffee-hero", "--lean-r")).not.toBe("");
    await expect(page.locator("canvas[data-dots]")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("data-sun", /^(dawn|day|dusk|night)$/);
    await expect(page.locator("canvas[data-doodle]")).toHaveCount(0);
  });

  test("Book a time throws stickers", async ({ page }) => {
    await page.goto(`${fixtureUrl("full")}coffee`);
    await ready(page);
    await page.evaluate(() => document.addEventListener("click", (e) => (e.target as Element).closest("[data-burst]") && e.preventDefault()));
    await page.locator("[data-burst]").first().click();
    expect(await page.locator("[data-burst-sticker]").count()).toBeGreaterThan(5);
  });
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
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
    await expect.poll(() => tileVar(page, "location", "--lean-r")).toMatch(/^1\.\d+deg$/);
  });

  test("only the hovered tile leans", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const box = (await page.locator('[data-tile="github"]').boundingBox())!;
    await page.mouse.move(box.x + box.width - 10, box.y + 10);
    await expect.poll(() => tileVar(page, "github", "--lean-r")).not.toBe("");
    for (const other of ["hello", "location", "photo"]) expect(await tileVar(page, other, "--lean-r")).toBe("");
  });

  test("no lean off-tile", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const box = (await page.locator('[data-tile="location"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => tileVar(page, "location", "--lean-r")).not.toBe("");
    const vp = page.viewportSize()!;
    await page.mouse.move(vp.width - 5, vp.height - 5);
    await expect
      .poll(() => page.locator("[data-tile]").evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue("--lean-r")).join("")))
      .toBe("");
  });

  test("lean uses no 3D turn", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const box = (await page.locator('[data-tile="photo"]').boundingBox())!;
    await page.mouse.move(box.x + box.width - 10, box.y + 10);
    await expect.poll(() => tileVar(page, "photo", "--lean-r")).not.toBe("");
    const transform = await page.locator('[data-tile="photo"] .shadow-tile').first().evaluate((el) => getComputedStyle(el).transform);
    expect(transform.startsWith("matrix(")).toBe(true);
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
    expect(await tileVar(page, "location", "--lean-r")).toBe("");
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

  test("scrolling redraws dots once per frame, not per event", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await expect(page.locator("canvas[data-dots]")).toHaveCount(1);
    const fillsDuringBurst = await page.evaluate(() => {
      let fills = 0;
      const fill = CanvasRenderingContext2D.prototype.fill;
      CanvasRenderingContext2D.prototype.fill = function (this: CanvasRenderingContext2D, ...args: never[]) {
        fills++;
        return Reflect.apply(fill, this, args);
      };
      for (let i = 0; i < 20; i++) window.dispatchEvent(new Event("scroll"));
      CanvasRenderingContext2D.prototype.fill = fill;
      return fills;
    });
    expect(fillsDuringBurst).toBe(0);
  });

  test("no dot field with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await expect(page.locator("canvas[data-dots]")).toHaveCount(0);
  });
});

test("sun phase is set", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-sun", /^(dawn|day|dusk|night)$/);
});

test("page html holds no zone name", async ({ request }) => {
  const html = await (await request.get(fixtureUrl("private"))).text();
  expect(html).not.toMatch(/(America|Europe|Asia|Africa|Australia|Pacific)\//);
});

const doodleInk =(page: Page) =>
  page.locator("canvas[data-doodle]").evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  });

async function scribble(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const grid = (await page.locator("[data-board-grid]").boundingBox())!;
  const x = grid.x + 60;
  const y = grid.y + 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 20, y + (i % 2) * 15);
  await page.mouse.up();
  return { x: 60, y: 120 };
}

test.describe("doodle", () => {
  test.skip(({ isMobile }) => isMobile, "mouse only");

  test("draw button is a labeled toggle", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    const draw = page.getByRole("button", { name: "Draw on the board" });
    await expect(draw).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    await draw.click();
    await expect(draw).toHaveAttribute("aria-pressed", "true");
  });

  test("draw mode paints a line", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await page.getByRole("button", { name: "Draw on the board" }).click({ timeout: 15_000 });
    await scribble(page);
    expect(await doodleInk(page)).toBe(true);
  });

  test("escape leaves draw mode and tiles click again", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    const draw = page.getByRole("button", { name: "Draw on the board" });
    await draw.click({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(draw).toHaveAttribute("aria-pressed", "false");
    const link = page.getByRole("link", { name: "See what I'm building" });
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = (await link.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit).toBe("https://github.com/masonbair");
  });

  test("doodle stays put on scroll", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await page.getByRole("button", { name: "Draw on the board" }).click({ timeout: 15_000 });
    const start = await scribble(page);
    const where = () =>
      page.evaluate(({ x, y }) => {
        const c = document.querySelector<HTMLCanvasElement>("canvas[data-doodle]")!;
        const grid = document.querySelector("[data-board-grid]")!.getBoundingClientRect();
        const box = c.getBoundingClientRect();
        // The stroke started at grid-relative (x, y); read the canvas pixel there.
        const dpr = c.width / box.width;
        const px = Math.round((grid.left + x - box.left) * dpr);
        const py = Math.round((grid.top + y - box.top) * dpr);
        const alpha = c.getContext("2d")!.getImageData(px, py, 1, 1).data[3];
        return { offset: Math.round(box.top - grid.top), inked: alpha > 0 };
      }, start);
    const before = await where();
    expect(before.inked).toBe(true);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    expect(await where()).toEqual(before);
  });

  test("clear wipes the doodle", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await page.getByRole("button", { name: "Draw on the board" }).click({ timeout: 15_000 });
    await scribble(page);
    await page.getByRole("button", { name: "Clear drawing" }).click();
    expect(await doodleInk(page)).toBe(false);
  });

  test("doodle is gone after reload", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await page.getByRole("button", { name: "Draw on the board" }).click({ timeout: 15_000 });
    await scribble(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "Draw on the board" })).toBeVisible({ timeout: 15_000 });
    expect(await doodleInk(page)).toBe(false);
  });
});

test("draw buttons sit under the board, never on a tile", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const draw = page.getByRole("button", { name: "Draw on the board" });
  await expect(draw).toBeVisible({ timeout: 15_000 });
  const grid = (await page.locator("[data-board-grid]").boundingBox())!;
  const button = (await draw.boundingBox())!;
  expect(button.y).toBeGreaterThanOrEqual(grid.y + grid.height);
});

test("draw toggles from the keyboard", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const draw = page.getByRole("button", { name: "Draw on the board" });
  await expect(draw).toBeVisible({ timeout: 15_000 });
  await draw.focus();
  await page.keyboard.press("Enter");
  await expect(draw).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(draw).toHaveAttribute("aria-pressed", "false");
});

test.describe("touch", () => {
  test.skip(({ isMobile }) => !isMobile, "touch only");

  test("touch outside draw mode never draws", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await expect(page.getByRole("button", { name: "Draw on the board" })).toBeVisible({ timeout: 15_000 });
    for (const [type, y] of [
      ["pointerdown", 400],
      ["pointermove", 300],
      ["pointerup", 200],
    ] as const) {
      await page.mouse.move(150, y);
      await page.evaluate(
        ([t, yy]) => document.elementFromPoint(150, yy)?.dispatchEvent(new PointerEvent(t, { pointerType: "touch", clientX: 150, clientY: yy, bubbles: true })),
        [type, y] as const,
      );
    }
    expect(await doodleInk(page)).toBe(false);
  });

  test("no dot field on touch", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    await expect(page.locator("canvas[data-dots]")).toHaveCount(0);
  });

  test("no lean on touch, press still lifts", async ({ page }) => {
    await page.goto(fixtureUrl("full"));
    await ready(page);
    const tile = page.locator('[data-tile="location"]');
    await tile.dispatchEvent("pointermove", { pointerType: "touch", clientX: 10, clientY: 10, bubbles: true });
    await tile.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
    await expect.poll(() => tileVar(page, "location", "--lift")).toBe("-4px");
    expect(await tileVar(page, "location", "--lean-r")).toBe("");
  });
});
