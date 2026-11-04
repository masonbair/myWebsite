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
