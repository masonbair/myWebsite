import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { HUB_PORT } from "./hub-ports";
import { newUser, seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// Runs only in the "hub" project against local Supabase. Rows can never be deleted, so titles are unique per run.

async function itemsTitled(title: string) {
  const { data, error } = await serviceClient().from("items").select("id, title, description, source, list").eq("title", title);
  if (error) throw error;
  return data as { id: string; title: string; description: string; source: string; list: string }[];
}

test.describe("quick capture", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");
  // Each test compiles new dev-server routes on first hit, which can pass 30s on a busy machine.
  test.slow();

  test.describe("as Mason", () => {
    test.beforeEach(async ({ context }) => {
      await signInAs(context, await seededOwner());
    });

    test("a capture made offline waits, then lands in the inbox exactly once", async ({ page, context }) => {
      const title = `offline ${randomUUID().slice(0, 8)}`;
      await page.goto("/hub/capture");
      const field = page.getByRole("textbox", { name: "Capture" });
      await expect(field).toBeFocused();

      await context.setOffline(true);
      await field.fill(title);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("1 waiting")).toBeVisible();
      await expect(field).toHaveValue("");
      expect(await itemsTitled(title)).toHaveLength(0);

      await context.setOffline(false);
      await expect.poll(async () => (await itemsTitled(title)).length, { timeout: 30_000 }).toBe(1);
      await expect(page.getByText("1 waiting")).toHaveCount(0);

      await page.goto("/hub");
      await expect(page.getByRole("region", { name: "Unsorted" }).getByRole("link", { name: title })).toHaveCount(1);
      const [item] = await itemsTitled(title);
      expect(item).toMatchObject({ source: "capture", list: "inbox" });
    });

    test("a capture waiting from an earlier visit is sent when the page loads", async ({ page, context }) => {
      const title = `reload ${randomUUID().slice(0, 8)}`;
      await page.goto("/hub/capture");
      await context.setOffline(true);
      await page.getByRole("textbox", { name: "Capture" }).fill(title);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("1 waiting")).toBeVisible();
      await page.close();
      await context.setOffline(false);

      const again = await context.newPage();
      await again.goto("/hub/capture");
      await expect.poll(async () => (await itemsTitled(title)).length).toBe(1);
      await expect(again.getByText("1 waiting")).toHaveCount(0);
    });

    test("double-clicking Save creates one item", async ({ page }) => {
      const title = `double ${randomUUID().slice(0, 8)}`;
      await page.goto("/hub/capture");
      await page.getByRole("textbox", { name: "Capture" }).fill(`${title}\nwith a second line`);
      await page.getByRole("button", { name: "Save" }).dblclick();
      await expect(page.getByText("Saved")).toBeVisible();
      await expect.poll(async () => (await itemsTitled(title)).length).toBe(1);
      // Give any second request time to land before checking there is still only one.
      await page.waitForTimeout(1000);
      const items = await itemsTitled(title);
      expect(items).toHaveLength(1);
      expect(items[0].description).toBe("with a second line");
    });

    test("the same capture key sent twice makes one item", async ({ page }) => {
      const title = `repeat ${randomUUID().slice(0, 8)}`;
      const body = { title, clientKey: randomUUID() };
      const first = await page.request.post("/api/hub/capture", { data: body });
      const second = await page.request.post("/api/hub/capture", { data: body });
      expect(first.status()).toBe(201);
      expect(second.status()).toBe(200);
      expect((await second.json()).id).toBe((await first.json()).id);
      expect(await itemsTitled(title)).toHaveLength(1);
    });

    test("bad input is refused", async ({ page }) => {
      const res = await page.request.post("/api/hub/capture", { data: { title: " ", clientKey: randomUUID() } });
      expect(res.status()).toBe(400);
    });

    test("a capture from another site is refused", async ({ page }) => {
      const title = `csrf ${randomUUID().slice(0, 8)}`;
      const res = await page.request.post("/api/hub/capture", {
        data: { title, clientKey: randomUUID() },
        headers: { origin: "https://evil.example" },
      });
      expect(res.status()).toBe(403);
      const share = await page.request.post("/hub/share", {
        multipart: { title, url: "https://example.com" },
        headers: { origin: "https://evil.example" },
        maxRedirects: 0,
      });
      expect(share.status()).toBe(403);
      expect(await itemsTitled(title)).toHaveLength(0);
    });

    test("posting the share form creates an inbox item with the shared url", async ({ page }) => {
      const title = `shared ${randomUUID().slice(0, 8)}`;
      const url = `https://example.com/${randomUUID()}`;
      const res = await page.request.post("/hub/share", {
        multipart: { title, text: "worth reading", url },
        headers: { origin: `http://localhost:${HUB_PORT}` },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(303);
      expect(new URL(res.headers().location, "http://x").pathname).toBe("/hub/capture");
      const items = await itemsTitled(title);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ source: "share", list: "inbox" });
      expect(items[0].description).toContain(url);
    });

    test("a share with Origin null, as Android sends it, is accepted", async ({ page }) => {
      const title = `null origin ${randomUUID().slice(0, 8)}`;
      const url = `https://example.com/${randomUUID()}`;
      const res = await page.request.post("/hub/share", {
        multipart: { title, url },
        headers: { origin: "null" },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(303);
      const items = await itemsTitled(title);
      expect(items).toHaveLength(1);
      expect(items[0].description).toContain(url);
    });

    test("the capture api still refuses Origin null", async ({ page }) => {
      const res = await page.request.post("/api/hub/capture", {
        data: { title: `null ${randomUUID().slice(0, 8)}`, clientKey: randomUUID() },
        headers: { origin: "null" },
      });
      expect(res.status()).toBe(403);
    });

    test("a waiting capture is sent from any hub page, not only the capture page", async ({ page }) => {
      const title = `elsewhere ${randomUUID().slice(0, 8)}`;
      await page.goto("/hub/login");
      await page.evaluate((entry) => localStorage.setItem("hub-outbox", JSON.stringify([entry])), {
        clientKey: randomUUID(),
        title,
        description: "",
        createdAt: new Date().toISOString(),
      });
      await page.goto("/hub");
      await expect.poll(async () => (await itemsTitled(title)).length).toBe(1);
      await expect.poll(() => page.evaluate(() => localStorage.getItem("hub-outbox"))).toBe("[]");
    });

    test("when the phone cannot store a capture, Save says so and keeps the text", async ({ page }) => {
      await page.addInitScript(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key === "hub-outbox") throw new DOMException("full", "QuotaExceededError");
          return setItem.call(this, key, value);
        };
      });
      const title = `full ${randomUUID().slice(0, 8)}`;
      await page.goto("/hub/capture");
      const field = page.getByRole("textbox", { name: "Capture" });
      await field.fill(title);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Could not save on this phone. Copy your text.")).toBeVisible();
      await expect(field).toHaveValue(title);
      await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
    });

    test("when storage is blocked, captures still send and a notice explains they last only while the tab is open", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException("blocked", "SecurityError");
        };
      });
      const title = `memory ${randomUUID().slice(0, 8)}`;
      await page.goto("/hub/capture");
      await expect(page.getByText("Captures last only while this tab is open.", { exact: false })).toBeVisible();
      await page.getByRole("textbox", { name: "Capture" }).fill(title);
      await page.getByRole("button", { name: "Save" }).click();
      await expect.poll(async () => (await itemsTitled(title)).length).toBe(1);
    });

    test("the share page says the shared item was saved", async ({ page }) => {
      await page.goto("/hub/capture?shared=1");
      await expect(page.getByText("Shared item saved")).toBeVisible();
    });
  });

  test("signed out, the capture api answers 401 json, not a redirect", async ({ request }) => {
    const res = await request.post("/api/hub/capture", { data: { title: "x", clientKey: randomUUID() }, maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("signed out, sharing sends you to the login page", async ({ request }) => {
    const res = await request.post("/hub/share", { multipart: { title: "x" }, maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(new URL(res.headers().location, "http://x").pathname).toBe("/hub/login");
  });

  test("someone else signed in cannot capture", async ({ page, context }) => {
    await signInAs(context, await newUser());
    const res = await page.request.post("/api/hub/capture", { data: { title: "x", clientKey: randomUUID() } });
    expect(res.status()).toBe(403);
  });

  test("the manifest and icons are public and describe the installable app", async ({ request }) => {
    const res = await request.get("/hub/manifest.webmanifest", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = await res.json();
    expect(manifest).toMatchObject({
      name: "Mason's hub",
      start_url: "/hub/capture",
      scope: "/hub/",
      display: "standalone",
      share_target: {
        action: "/hub/share",
        method: "POST",
        enctype: "multipart/form-data",
        params: { title: "title", text: "text", url: "url" },
      },
    });
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const image = await request.get(icon.src, { maxRedirects: 0 });
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
    }
    expect((manifest.icons as { sizes: string }[]).map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
  });

  test("hub pages link the manifest", async ({ page, context }) => {
    await signInAs(context, await seededOwner());
    await page.goto("/hub/capture");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/hub/manifest.webmanifest");
  });
});
