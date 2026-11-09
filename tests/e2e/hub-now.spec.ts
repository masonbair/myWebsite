import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
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

    test("marking home private sticks across a new public ping, and marking it public shows the city again", async ({ page, request }) => {
      const city = `Placeville${randomUUID().slice(0, 8)}`;
      // Stands in for the phone collector, which always sends private = false.
      const ping = async () => {
        const { error } = await serviceClient().from("now_place").insert({ city, region: "Ohio", country: "United States", private: false });
        expect(error).toBeNull();
      };
      const boardHtml = async () => (await request.get("/")).text();

      await ping();
      await page.goto("/hub/now");
      const place = page.getByRole("region", { name: "Current place" });
      await expect(place.getByText(`${city}, Ohio, United States`)).toBeVisible();
      await expect(place.getByText(`The site shows ${city}, United States`)).toBeVisible();
      const toggle = place.getByRole("switch", { name: "Mark this place private" });
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(place.getByText("The site shows Ohio, United States")).toBeVisible();
      // The database stores privacy rules normalized, so a phone's spelling can't dodge them.
      const marks = await serviceClient().from("now_place_privacy").select("city, country, private").eq("city", city.toLowerCase());
      expect(marks.data).toEqual([{ city: city.toLowerCase(), country: "us", private: true }]);

      await ping();
      await page.goto("/");
      await expect(page.getByText("Ohio, United States")).toBeVisible();
      // Raw response, so the RSC payload is checked too.
      expect(await boardHtml()).not.toContain(city);

      await page.goto("/hub/now");
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await page.goto("/");
      await expect(page.getByText(`${city}, United States`)).toBeVisible();
    });

    test("a phone photo shows on the board until it is hidden in the hub, and comes back when shown", async ({ page, request }) => {
      const assetId = `e2e${randomUUID().slice(0, 8)}`;
      const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: "teal" } }).jpeg().toBuffer();
      // Stands in for the phone, which uploads the object and then adds the row.
      const upload = await serviceClient().storage.from("photos").upload(`collector/${assetId}.jpg`, jpeg, { contentType: "image/jpeg" });
      expect(upload.error).toBeNull();
      const added = await serviceClient()
        .from("collector_photo")
        .insert({ path: `collector/${assetId}.jpg`, asset_id: assetId, taken_at: new Date().toISOString(), width: 300, height: 400 });
      expect(added.error).toBeNull();
      const route = `/photos/${assetId}`;
      const boardHtml = async () => (await request.get("/")).text();

      await page.goto("/");
      await expect(page.getByRole("group", { name: "Photo slideshow" }).locator(`img[src^="${route}?w="]`)).toHaveAttribute("alt", /^Photo from Mason's phone, /);
      const served = await request.get(route);
      expect(served.status()).toBe(200);
      expect(served.headers()["content-type"]).toBe("image/jpeg");

      await page.goto("/hub/now");
      const card = page.getByRole("region", { name: "Photos from the phone" }).getByRole("listitem").filter({ has: page.locator(`img[src*="${assetId}"]`) });
      await card.getByRole("button", { name: /^Hide photo from / }).click();
      await expect(card.getByRole("button", { name: /^Show photo from / })).toBeVisible();
      await expect(card.getByText("Hidden", { exact: true })).toBeVisible();
      expect(await boardHtml()).not.toContain(route);
      expect((await request.get(route)).status()).toBe(404);

      await card.getByRole("button", { name: /^Show photo from / }).click();
      await expect(card.getByRole("button", { name: /^Hide photo from / })).toBeVisible();
      expect(await boardHtml()).toContain(route);
    });

    test("a photo that is not on the site is refused", async ({ page }) => {
      await page.goto("/hub/now");
      await page.getByLabel("What did you bake?").fill("e2e missing photo");
      await page.getByLabel(/Photo path/).fill("/misc/not-a-real-file.webp");
      await page.getByRole("button", { name: "Log bake" }).click();
      await expect(page.getByRole("region", { name: "Log a bake" }).getByRole("alert")).toHaveText(
        "There is no /misc/not-a-real-file.webp on the site. Check the file name.",
      );
    });

    test("has no serious accessibility problems", async ({ page }) => {
      await page.goto("/hub/now");
      await expect(page.getByRole("heading", { level: 1, name: "Now" })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    });
  });
});
