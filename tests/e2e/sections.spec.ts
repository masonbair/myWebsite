import { expect, test } from "@playwright/test";
import { PHONE } from "./phone";

test("anchors exist", async ({ page }) => {
  await page.goto("/");
  for (const id of ["about", "projects", "achievements", "resume"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
});

test("resume download works", async ({ page, request }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "Download résumé" });
  await expect(link).toHaveAttribute("href", "/misc/Mason_Bair_Resume_01_20_2026.pdf");
  const res = await request.get((await link.getAttribute("href"))!);
  expect(res.status()).toBe(200);
});

test("facts carried over", async ({ page }) => {
  await page.goto("/");
  const text = await page.locator("body").innerText();
  for (const fact of ["Kent State", "Nationwide", "HacKSU", "Eagle Scout", "Tartu"]) {
    expect(text).toContain(fact);
  }
});

test("nav anchors scroll", async ({ page }, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await expect
    .poll(() => page.locator("#projects").evaluate((el) => Math.abs(el.getBoundingClientRect().top)))
    .toBeLessThanOrEqual(100);
});

test("gallery strip scrolls inside itself", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone width only");
  await page.goto("/");
  const strip = page.getByRole("region", { name: "Event and club photos" });
  await expect(strip).toHaveAttribute("tabindex", "0");
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("no phone number in page HTML or text", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  expect(html).not.toMatch(PHONE);
  expect(html).not.toContain("tel:");
  await page.goto("/");
  expect(await page.locator("body").innerText()).not.toMatch(PHONE);
});

test("resume contact block links to the coffee chat page", async ({ page }) => {
  await page.goto("/");
  const link = page.locator("#resume").getByRole("link", { name: "Book a coffee chat" });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/coffee");
  await link.click();
  await expect(page).toHaveURL(/\/coffee$/);
});

test("ended roles are in the past and copy is current", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).not.toContain("to present");
  expect(html).toContain("digital nomad");
  expect(html).not.toContain("Hackathons and honors");
  expect(html).toContain("August 2025 to May 2026");
  expect(html).toContain("May 2025 to May 2026");
  expect(html).toContain("Hackathons and side projects");
  expect(html).toContain("digital nomad (23 countries so far)");
  expect(html).not.toContain("21 countries");
});
