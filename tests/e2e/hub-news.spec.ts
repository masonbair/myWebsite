import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// News issues can never be deleted, so subjects are unique per run.
test.describe.configure({ mode: "serial" });

async function seedIssue(row: { subject: string; status: string; source_id: string | null; last_error?: string; from_address?: string }) {
  const { data, error } = await serviceClient()
    .from("news_issues")
    .insert({ message_id: `e2e-${randomUUID()}`, raw_path: "", ...row })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

test.describe("news page", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test("signed out, /hub/news goes to the login page", async ({ page }) => {
    await page.goto("/hub/news");
    await expect(page).toHaveURL(/\/hub\/login/);
  });

  test.describe("as the owner", () => {
    test.beforeEach(async ({ context }) => {
      await signInAs(context, await seededOwner());
    });

    test("shows a failed issue and retry puts it back in the queue", async ({ page }) => {
      const subject = `e2e failed ${randomUUID().slice(0, 8)}`;
      await seedIssue({ subject, status: "failed", source_id: "rundown-ai", last_error: "rate limited" });
      await page.goto("/hub/news");
      await expect(page.getByRole("heading", { level: 1, name: "News" })).toBeVisible();
      await expect(page.getByText("Costs show once the shared cost log is live.")).toBeVisible();
      const row = page.getByRole("listitem").filter({ hasText: subject });
      await expect(row).toContainText("Failed");
      await expect(row).toContainText("rate limited");
      await row.getByRole("button", { name: "Retry" }).click();
      await expect(row).toContainText("Waiting");
      await expect(row.getByRole("button", { name: "Retry" })).toHaveCount(0);
    });

    test("lists a held back email and opens it, saying so when the raw email is gone", async ({ page }) => {
      const subject = `e2e held ${randomUUID().slice(0, 8)}`;
      const id = await seedIssue({ subject, status: "quarantined", source_id: null, from_address: "mail-noreply@google.com" });
      await page.goto("/hub/news");
      const link = page.getByRole("link", { name: new RegExp(subject) });
      await expect(link).toContainText("View");
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/hub/news/quarantine/${id}$`));
      await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
      await expect(page.getByText("The raw email could not be loaded.")).toBeVisible();
    });

    test("the page and the inbox fit a 360px phone with no sideways scroll", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      for (const path of ["/hub/news", "/hub"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(fits, path).toBe(true);
      }
    });

    test("a made-up or non-held issue id is a 404", async ({ page }) => {
      const res = await page.goto(`/hub/news/quarantine/${randomUUID()}`);
      expect(res?.status()).toBe(404);
    });

    test("has no serious accessibility problems", async ({ page }) => {
      await page.goto("/hub/news");
      await expect(page.getByRole("heading", { level: 1, name: "News" })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    });
  });
});
