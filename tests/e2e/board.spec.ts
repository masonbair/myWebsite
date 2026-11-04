import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

test("full board shows location", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  await expect(page.getByText("Lisbon, Portugal")).toBeVisible();
});

test("private place hides city", async ({ page, request }) => {
  await page.goto(fixtureUrl("private"));
  await expect(page.getByText("Ohio, United States")).toBeVisible();
  // Raw response, so the RSC payload is checked too.
  const html = await (await request.get(fixtureUrl("private"))).text();
  expect(html).not.toContain("Ravenna");
});

test("html never contains lat", async ({ page, request }) => {
  await page.goto(fixtureUrl("coords"));
  await expect(page.getByText("Porto, Portugal")).toBeVisible();
  const html = await (await request.get(fixtureUrl("coords"))).text();
  expect(html).not.toContain('"lat"');
  expect(html).not.toContain("lat:");
  expect(html).not.toContain("41.1579");
});

test("board renders when github is null", async ({ page }) => {
  await page.goto(fixtureUrl("full"));
  const link = page.getByRole("link", { name: "See what I'm building" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://github.com/masonbair");
});

test("empty photos shows fallback", async ({ page }) => {
  await page.goto(fixtureUrl("empty"));
  const img = page.locator('img[src*="Mason_traveling"]').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("no empty grid cells", async ({ page }) => {
  await page.goto(fixtureUrl("empty"));
  const cells = await page.locator("[data-board-grid] > *").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).innerText.trim().length > 0 || el.querySelector("img") !== null),
  );
  expect(cells.length).toBeGreaterThan(0);
  expect(cells.every(Boolean)).toBe(true);
});

test("mobile has no horizontal scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone width only");
  await page.goto(fixtureUrl("full"));
  await expect(page.getByRole("heading", { name: "Hi, I'm Mason." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("hello visible without scroll", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Hi, I'm Mason." });
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test.describe("without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("hello shows without javascript", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Hi, I'm Mason." });
    await expect(heading).toBeVisible();
    // toBeVisible ignores opacity, so multiply it up the tree to catch a fade that never finishes.
    await expect
      .poll(() =>
        heading.evaluate((el) => {
          let opacity = 1;
          for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
          return opacity;
        }),
      )
      .toBe(1);
  });
});

test("github tile shows the total and never ships a private repo name", async ({ page, request }) => {
  await page.goto(fixtureUrl("github"));
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("contributions", { exact: true })).toBeVisible();
  await expect(page.getByText("public commits across")).toBeVisible();
  const html = await (await request.get(fixtureUrl("github"))).text();
  expect(html).not.toContain("secret-client-repo");
});

test("github count never clips", async ({ page }) => {
  await page.goto(fixtureUrl("github"));
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  // A handle, because the locator stops matching once the text is swapped.
  const count = (await page.getByText("12", { exact: true }).elementHandle())!;
  for (const width of [1280, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [n, label] of [["1,330", "contributions"], ["1", "contribution"]]) {
      const clipped = await count.evaluate(
        (el: HTMLElement, [n, label]) => {
          el.textContent = n;
          el.nextElementSibling!.textContent = label;
          const core = el.closest(".overflow-hidden")!.getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(el.closest(".overflow-hidden")!).paddingRight);
          return [el, el.nextElementSibling!].some((e) => e.getBoundingClientRect().right > core.right - pad + 0.5);
        },
        [n, label],
      );
      expect(clipped, `${n} ${label} at ${width}px`).toBe(false);
    }
  }
});

test.describe("photo slideshow", () => {
  const slideshow = (page: Page) => page.getByRole("group", { name: "Photo slideshow" });
  const visiblePhoto = (page: Page) => slideshow(page).locator('img:not([aria-hidden="true"])');

  test("pause button stops rotation, and so does keyboard focus", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    const pause = page.getByRole("button", { name: "Pause photo slideshow" });
    await expect(pause).toBeVisible();
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    const first = await visiblePhoto(page).getAttribute("alt");
    await page.clock.fastForward(6500);
    await expect(visiblePhoto(page)).not.toHaveAttribute("alt", first!);

    await pause.click();
    await page.mouse.move(0, 0);
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    const held = await visiblePhoto(page).getAttribute("alt");
    await page.clock.fastForward(20_000);
    await expect(visiblePhoto(page)).toHaveAttribute("alt", held!);

    // Unpaused but still focused: focus alone keeps it still.
    await pause.click();
    await page.mouse.move(0, 0);
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    await expect(pause).toBeFocused();
    await page.clock.fastForward(20_000);
    await expect(visiblePhoto(page)).toHaveAttribute("alt", held!);

    await pause.blur();
    await page.clock.fastForward(6500);
    await expect(visiblePhoto(page)).not.toHaveAttribute("alt", held!);
  });

  test.describe("without javascript", () => {
    test.use({ javaScriptEnabled: false });

    test("only the first photo is in the server HTML", async ({ page }) => {
      await page.goto("/");
      await expect(slideshow(page).locator("img")).toHaveCount(1);
      await expect(slideshow(page).locator("img")).toHaveAttribute("loading", "eager");
      const src = await slideshow(page).locator("img").getAttribute("src");
      const file = new URL(src!, "http://x").searchParams.get("url") ?? src!;
      await expect(page.locator(`link[rel="preload"][imagesrcset*="${encodeURIComponent(file)}"]`)).toHaveCount(0);
    });
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("stays on one photo with no control", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Hi, I'm Mason." })).toBeVisible();
      await page.waitForLoadState("load");
      await page.waitForTimeout(500);
      await expect(page.getByRole("button", { name: "Pause photo slideshow" })).toHaveCount(0);
      await expect(slideshow(page).locator("img")).toHaveCount(1);
    });
  });
});
