import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }));
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme, reducedMotion: "reduce" });

    test("home page has no serious a11y violations", async ({ page }) => {
      await page.goto("/");
      // The game mounts after load; scan it too, not just the static shell.
      await expect(page.getByRole("button", { name: "Start the cat game" })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });

    test("coffee page has no serious a11y violations", async ({ page }) => {
      await page.goto("/coffee");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });

    test("mobile menu open has no serious a11y violations", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "menu button is mobile only");
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Start the cat game" })).toBeVisible();
      await page.getByRole("button", { name: "Open menu" }).click();
      await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });

    test("leaderboard dialog open has no serious a11y violations", async ({ page }) => {
      await page.route("**/api/leaderboard", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
      await page.goto("/");
      await page.getByRole("button", { name: "Start the cat game" }).click();
      await page.getByRole("button", { name: /leaderboard/i }).click();
      await expect(page.getByRole("dialog", { name: "Leaderboard" })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  });
}
