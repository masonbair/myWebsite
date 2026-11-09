import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ownerDbClient, seededOwner, signInAs } from "./hub-session";

// Runs only in the "hub" project against local Supabase, whose rollups are never deleted, so counts are compared as deltas.
// Other hub specs load "/" in parallel, so every human request here carries a country no other spec sends and asserts only on it.
const MARK = { "x-vercel-ip-country": "ZZ" };

const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function hits(filter: Record<string, string>): Promise<number> {
  const { data, error } = await (await ownerDbClient()).from("analytics_daily").select("hits").match(filter);
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.hits, 0);
}

test.describe("site analytics", () => {
  test("public page reads are counted on the server and shown to the owner", async ({ page, request, context }) => {
    const gptBefore = await hits({ path: "/", agent: "GPTBot" });
    const coffeeBefore = await hits({ path: "/coffee", kind: "human", from_assistant: "ChatGPT", country: "ZZ" });

    expect((await request.get("/", { headers: { "user-agent": GPTBOT } })).ok()).toBe(true);
    expect(
      (await request.get("/coffee?utm_source=chatgpt.com", { headers: { "user-agent": CHROME, "x-real-ip": "198.51.100.7", ...MARK } })).ok(),
    ).toBe(true);

    await expect.poll(() => hits({ path: "/", agent: "GPTBot" })).toBe(gptBefore + 1);
    await expect.poll(() => hits({ path: "/coffee", kind: "human", from_assistant: "ChatGPT", country: "ZZ" })).toBe(coffeeBefore + 1);

    // A prefetch reaches the proxy without Next's own headers, so only sec-fetch-dest tells it apart.
    const coffeeHumans = await hits({ path: "/coffee", kind: "human", country: "ZZ" });
    await request.get("/coffee", { headers: { "user-agent": CHROME, "sec-fetch-dest": "empty", rsc: "1", "next-router-prefetch": "1", ...MARK } });
    const gptMarker = await hits({ path: "/", agent: "GPTBot" });
    await request.get("/", { headers: { "user-agent": GPTBOT } });
    await expect.poll(() => hits({ path: "/", agent: "GPTBot" })).toBe(gptMarker + 1);
    expect(await hits({ path: "/coffee", kind: "human", country: "ZZ" })).toBe(coffeeHumans);

    const owner = await seededOwner();
    await signInAs(context, owner);
    await context.setExtraHTTPHeaders(MARK);
    const ownerBefore = await hits({ kind: "human", country: "ZZ" });
    await page.goto("/hub/analytics");
    await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "AI crawlers and agents" }).getByRole("cell", { name: "GPTBot" })).toBeVisible();
    await expect(page.getByRole("region", { name: "People from AI assistants" }).getByRole("cell", { name: "ChatGPT" })).toBeVisible();

    await page.goto("/");
    // A bot read after Mason's visit lands after it, so once it shows, a counted visit would show too.
    const gptNow = await hits({ path: "/", agent: "GPTBot" });
    await request.get("/", { headers: { "user-agent": GPTBOT } });
    await expect.poll(() => hits({ path: "/", agent: "GPTBot" })).toBe(gptNow + 1);
    expect(await hits({ kind: "human", country: "ZZ" })).toBe(ownerBefore);

    await page.goto("/hub/analytics");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
