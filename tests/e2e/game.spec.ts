import { expect, test, type Page } from "@playwright/test";

const circle = (page: Page) => page.getByRole("button", { name: "Catch the circle" });

async function startGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start the cat game" }).click();
}

async function catchCircles(page: Page, n: number, check?: () => Promise<void>) {
  for (let i = 0; i < n; i++) {
    await expect(circle(page)).toBeVisible();
    await check?.();
    await circle(page).click();
  }
}

test("clicking circles raises score", async ({ page }) => {
  await startGame(page);
  await catchCircles(page, 4);
  await expect(page.getByTestId("score")).toHaveText("4");
  await expect(page.locator("[data-cat]")).toHaveAttribute("data-stage", "2");
});

test("circle stays in viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone-width check");
  test.setTimeout(60_000);
  await startGame(page);
  const nav = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  await catchCircles(page, 10, async () => {
    // Poll so the box is read after the scale-in settles.
    await expect.poll(async () => (await circle(page).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    const box = (await circle(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(812);
    expect(box.y).toBeGreaterThan(nav!.y + nav!.height);
  });
});

test("local leaderboard saves", async ({ page }) => {
  await startGame(page);
  await catchCircles(page, 2);
  await page.getByRole("button", { name: /leaderboard/i }).click();
  await page.getByLabel("Your name").fill("Tester");
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByRole("list", { name: "Top scores" }).getByText("Tester")).toBeVisible();
});

test("game can be paused", async ({ page }) => {
  await startGame(page);
  await expect(circle(page)).toBeVisible();
  await page.getByRole("button", { name: "Pause the cat game" }).click();
  await expect(circle(page)).toHaveCount(0);
});

test("live circle stays on screen after a resize", async ({ page }) => {
  await startGame(page);
  // Catch until a circle sits low enough that the smaller viewport would cut it off.
  const size = { width: 340, height: 320 };
  for (let i = 0; i < 15; i++) {
    await expect(circle(page)).toBeVisible();
    await expect.poll(async () => (await circle(page).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    const box = (await circle(page).boundingBox())!;
    if (box.y + box.height > size.height + 20) break;
    await circle(page).click();
  }
  await page.setViewportSize(size);
  const nav = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await circle(page).boundingBox())!;
      return (
        box.x >= 0 &&
        box.y > nav.y + nav.height &&
        box.x + box.width <= size.width &&
        box.y + box.height <= size.height
      );
    })
    .toBe(true);
});

test("keyboard play keeps focus on the circles", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start the cat game" }).focus();
  await page.keyboard.press("Enter");
  await expect(circle(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("score")).toHaveText("1");
  await expect(circle(page)).toBeFocused();
});

test("leaderboard moves focus in and back", async ({ page }) => {
  await page.goto("/");
  const pill = page.getByRole("button", { name: /^Score \d+, leaderboard$/ });
  await pill.click();
  await expect(page.getByRole("button", { name: "Close leaderboard" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Leaderboard" })).toHaveCount(0);
  await expect(pill).toBeFocused();
});
