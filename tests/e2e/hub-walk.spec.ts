import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seededOwner, signInAs, supabase } from "./hub-session";

// The hub server has no ideas key, so the deck is starter cards only.
test.describe("walk page", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test.beforeEach(async ({ context }) => {
    await signInAs(context, await seededOwner());
  });

  test("shows one starter at a time and Next moves through the deck", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/hub/walk");
    const card = page.getByRole("region", { name: "Walk prompt" });
    await expect(card).toContainText("1 of 8");
    await expect(card).toContainText("Starter");
    const first = await card.locator("[aria-live]").textContent();
    if (process.env.WALK_SHOT) await page.screenshot({ path: `${process.env.WALK_SHOT}/walk-1.png` });

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(card).toContainText("2 of 8");
    expect(await card.locator("[aria-live]").textContent()).not.toBe(first);
    if (process.env.WALK_SHOT) await page.screenshot({ path: `${process.env.WALK_SHOT}/walk-2.png` });

    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations).toEqual([]);
  });
});
