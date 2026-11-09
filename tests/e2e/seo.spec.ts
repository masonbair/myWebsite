import { expect, test, type APIRequestContext } from "@playwright/test";
import { PHONE } from "./phone";

const BOOKING_URL = "https://calendar.app.google/suAxGdTVkbEB2GFN6";
const PERSON_ID = "https://masonbair.com/#person";

const BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Googlebot",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "Bingbot",
];

type Node = Record<string, unknown>;

async function jsonLdBlocks(request: APIRequestContext, path: string) {
  const html = await (await request.get(path)).text();
  const raw = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return { raw, data: raw.map((r) => JSON.parse(r) as Node) };
}

test.describe("json-ld", () => {
  test.skip(({ isMobile }) => isMobile, "server output is the same on both projects");

  test("home has a ProfilePage for the Person with a coffee ScheduleAction", async ({ request }) => {
    const { raw, data } = await jsonLdBlocks(request, "/");
    expect(data).toHaveLength(1);
    raw.forEach((r) => expect(r).not.toContain("<"));
    const [page] = data;
    expect(page["@context"]).toBe("https://schema.org");
    expect(page["@type"]).toBe("ProfilePage");
    expect(typeof page.dateModified).toBe("string");
    const person = page.mainEntity as Node;
    expect(person["@type"]).toBe("Person");
    expect(person["@id"]).toBe(PERSON_ID);
    expect(person.sameAs).toEqual(
      expect.arrayContaining(["https://github.com/masonbair", "https://www.linkedin.com/in/masonbair/"]),
    );
    const action = person.potentialAction as Node;
    expect(action["@type"]).toBe("ScheduleAction");
    expect(action.target).toBe("https://masonbair.com/coffee");
  });

  test("coffee has a WebPage about the same Person", async ({ request }) => {
    const { raw, data } = await jsonLdBlocks(request, "/coffee");
    expect(data).toHaveLength(1);
    raw.forEach((r) => expect(r).not.toContain("<"));
    expect(data[0]["@context"]).toBe("https://schema.org");
    expect(data[0]["@type"]).toBe("WebPage");
    expect(data[0].about).toEqual({ "@id": PERSON_ID });
  });

  test("no FAQPage and no phone in any block", async ({ request }) => {
    for (const path of ["/", "/coffee"]) {
      const { raw } = await jsonLdBlocks(request, path);
      const all = raw.join("");
      expect(all).not.toContain("FAQPage");
      expect(all).not.toContain("telephone");
    }
  });
});

test.describe("crawl files", () => {
  test.skip(({ isMobile }) => isMobile, "server output is the same on both projects");

  test("robots.txt allows every listed bot and names the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const text = await res.text();
    for (const bot of BOTS) expect(text).toContain(`User-Agent: ${bot}\n`);
    expect(text).toContain("Sitemap: https://masonbair.com/sitemap.xml");
    expect(text).not.toMatch(/Disallow: \/\s*$/m);
  });

  test("sitemap lists home, coffee and trends", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<loc>https://masonbair.com</loc>");
    expect(xml).toContain("<loc>https://masonbair.com/coffee</loc>");
    expect(xml).toContain("<loc>https://masonbair.com/trends</loc>");
  });

  test("llms.txt is plain text with the coffee link and no phone", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("https://masonbair.com/coffee");
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(PHONE);
  });

  test("opengraph image renders", async ({ request }) => {
    const res = await request.get("/opengraph-image");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("home canonical and title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Mason Bair");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://masonbair.com");
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /opengraph-image/);
  });
});

test.describe("coffee page", () => {
  test("is a real page, not a redirect", async ({ request }) => {
    const res = await request.get("/coffee", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });

  test("has the exact heading, booking link, Q&As, and canonical", async ({ page }) => {
    await page.goto("/coffee");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Coffee chat with Mason Bair");
    const book = page.getByRole("link", { name: "Book a time" });
    await expect(book).toHaveAttribute("href", BOOKING_URL);
    await expect(book).toHaveAttribute("target", "_blank");
    await expect(book).toHaveAttribute("rel", "noopener noreferrer");
    const questions = await page.getByTestId("faq").locator("dt").count();
    expect(questions).toBeGreaterThanOrEqual(3);
    expect(questions).toBeLessThanOrEqual(5);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://masonbair.com/coffee");
    await expect(page).toHaveTitle("Coffee chat | Mason Bair");
    await expect(page.getByRole("main").getByRole("link", { name: /GitHub/ })).toHaveAttribute("href", "https://github.com/masonbair");
    await expect(page.getByRole("main").getByRole("link", { name: /LinkedIn/ })).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/masonbair/",
    );
  });

  test("no sideways scroll", async ({ page }) => {
    await page.goto("/coffee");
    const vw = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);
  });

  test("no phone, dashes, or coordinates", async ({ page, request }) => {
    const html = await (await request.get("/coffee")).text();
    expect(html).not.toMatch(PHONE);
    expect(html).not.toContain("tel:");
    expect(html).not.toContain('"lat"');
    expect(html).not.toContain("latitude");
    await page.goto("/coffee");
    const text = await page.evaluate(
      () => document.body.innerText + document.title + (document.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""),
    );
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(PHONE);
  });

  test("nav section links lead back to the home page", async ({ page }, testInfo) => {
    await page.goto("/coffee");
    if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Work", exact: true }).click();
    await expect(page).toHaveURL(/\/#projects$/);
    await expect(page.locator("#projects")).toHaveCount(1);
  });
});
