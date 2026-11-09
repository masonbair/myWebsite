import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl } from "./fixture-servers";

const fixture = JSON.parse(readFileSync("tests/e2e/fixtures/trends.json", "utf8")) as {
  sources: { name: string; homepage: string }[];
};
const SOURCE_HOSTS = new Set(fixture.sources.map((s) => new URL(s.homepage).host));
const SOURCE_NAMES = fixture.sources.map((s) => s.name);
const PRIVATE = "PRIVATE-HEADLINE-Zq7";
const FOOTER = "Counts of what six newsletters I read talked about. Not financial advice.";

const full = (path: string) => new URL(path, fixtureUrl("full")).toString();
const empty = (path: string) => new URL(path, fixtureUrl("empty")).toString();

async function outboundLinks(page: Page) {
  return page.locator("main a[href]").evaluateAll((els) =>
    els
      .map((el) => ({ href: (el as HTMLAnchorElement).href, text: (el as HTMLElement).innerText.trim() }))
      .filter((l) => new URL(l.href).origin !== location.origin),
  );
}

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

test("trends lists topics and companies with the not-advice line", async ({ page }) => {
  await page.goto(full("/trends"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const topics = page.getByRole("region", { name: "Topics" });
  const companies = page.getByRole("region", { name: "Companies" });
  await expect(topics.getByRole("link", { name: /AI chips/ })).toHaveAttribute("href", "/trends/topic/ai-chips");
  await expect(companies.getByRole("link", { name: /Nvidia/ })).toHaveAttribute("href", "/trends/company/101");
  await expect(page.getByText(FOOTER)).toBeVisible();
  await expect(page.getByText("Retired topic")).toHaveCount(0);
});

test("trends copy has no trading words and no em dashes", async ({ page }) => {
  for (const path of ["/trends", "/trends/topic/ai-chips", "/trends/company/101"]) {
    await page.goto(full(path));
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\b(buy|sell|bullish|bearish|price target|stocks to watch)\b/i);
    expect(text).not.toContain("—");
  }
});

test("trends pages never ship the fixture's private headline", async ({ request }) => {
  for (const path of ["/trends", "/trends/topic/ai-chips", "/trends/company/101", "/"]) {
    const res = await request.get(full(path));
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain(PRIVATE);
  }
});

test("subject page charts a year and links only to newsletter sites", async ({ page }) => {
  await page.goto(full("/trends/topic/ai-chips"));
  await expect(page.getByRole("heading", { level: 1, name: "AI chips" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Stories per week/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Tone per week/ })).toBeVisible();
  const links = await outboundLinks(page);
  expect(links.length).toBeGreaterThan(0);
  for (const { href, text } of links) {
    expect(SOURCE_HOSTS.has(new URL(href).host), href).toBe(true);
    expect(href).not.toContain("?");
    expect(text).toMatch(/^.+, [A-Z][a-z]{2} \d{1,2}$/);
    expect(SOURCE_NAMES).toContain(text.replace(/, [A-Z][a-z]{2} \d{1,2}$/, ""));
  }
});

test("trends list has no outbound links", async ({ page }) => {
  await page.goto(full("/trends"));
  await expect(page.getByText(FOOTER)).toBeVisible();
  expect(await outboundLinks(page)).toEqual([]);
});

test("unknown kind, unknown key and inactive topics are not found", async ({ request }) => {
  for (const path of ["/trends/story/ai-chips", "/trends/topic/no-such-topic", "/trends/company/abc", "/trends/topic/retired-topic"]) {
    expect((await request.get(full(path))).status(), path).toBe(404);
  }
});

test("empty trends answer 200 with the empty state", async ({ page }) => {
  const res = await page.goto(empty("/trends"));
  expect(res?.status()).toBe(200);
  await expect(page.getByText("Nothing to show yet.")).toBeVisible();
  await expect(page.getByText(FOOTER)).toBeVisible();
});

test("trends pages have no horizontal scroll at phone width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone width only");
  for (const path of ["/trends", "/trends/topic/ai-chips"]) {
    await page.goto(full(path));
    await expect(page.getByText(FOOTER)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme, reducedMotion: "reduce" });

    test("trends pages have no serious a11y violations", async ({ page }) => {
      for (const path of ["/trends", "/trends/company/101"]) {
        await page.goto(full(path));
        await expect(page.getByText(FOOTER)).toBeVisible();
        expect(await serious(page), path).toEqual([]);
      }
    });
  });
}
