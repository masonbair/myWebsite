import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// Runs on the hub server, whose `/` reads local Supabase. Rows can never be deleted, so names are unique per run and each test adds the newest row.
test.describe.configure({ mode: "serial" });

test.describe("now page", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test("signed out, /hub/now goes to the login page", async ({ page }) => {
    await page.goto("/hub/now");
    await expect(page).toHaveURL(/\/hub\/login/);
  });

  test.describe("as the owner", () => {
    test.beforeEach(async ({ context }) => {
      await signInAs(context, await seededOwner());
    });

    test("logging a bake shows it on the public board", async ({ page }) => {
      const name = `e2e loaf ${randomUUID().slice(0, 8)}`;
      await page.goto("/hub/now");
      await expect(page.getByRole("heading", { level: 1, name: "Now" })).toBeVisible();
      await page.getByLabel("What did you bake?").fill(name);
      await page.getByRole("button", { name: "Log bake" }).click();
      await expect(page.getByRole("status")).toContainText(`Logged ${name}`);
      await expect(page.getByRole("region", { name: "Last bake" }).getByText(name)).toBeVisible();

      await page.goto("/");
      await expect(page.getByText(name)).toBeVisible();
    });

    test("a bad photo path is refused with a plain message", async ({ page }) => {
      await page.goto("/hub/now");
      await page.getByLabel("What did you bake?").fill("e2e refused");
      await page.getByLabel(/Photo path/).fill("https://example.com/bread.webp");
      await page.getByRole("button", { name: "Log bake" }).click();
      await expect(page.getByRole("region", { name: "Log a bake" }).getByRole("alert")).toHaveText("The photo must be a file in /misc, like /misc/bread.webp.");
    });

    test("marking the place private adds a row and the board shows only state and country", async ({ page, request }) => {
      const city = `Placeville${randomUUID().slice(0, 8)}`;
      const seeded = await serviceClient()
        .from("now_place")
        .insert({ city, region: "Ohio", country: "United States", private: false });
      expect(seeded.error).toBeNull();

      await page.goto("/hub/now");
      const place = page.getByRole("region", { name: "Current place" });
      await expect(place.getByText(`${city}, Ohio, United States`)).toBeVisible();
      await expect(place.getByText(`The site shows ${city}, United States`)).toBeVisible();
      const toggle = place.getByRole("switch", { name: "Mark this place private" });
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(place.getByText("The site shows Ohio, United States")).toBeVisible();

      const rows = await serviceClient().from("now_place").select("private").eq("city", city).order("id");
      expect(rows.data).toEqual([{ private: false }, { private: true }]);

      await page.goto("/");
      await expect(page.getByText("Ohio, United States")).toBeVisible();
      // Raw response, so the RSC payload is checked too.
      const html = await (await request.get("/")).text();
      expect(html).not.toContain(city);
    });

    test("has no serious accessibility problems", async ({ page }) => {
      await page.goto("/hub/now");
      await expect(page.getByRole("heading", { level: 1, name: "Now" })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    });
  });
});
