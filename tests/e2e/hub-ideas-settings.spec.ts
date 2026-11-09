import { expect, test } from "@playwright/test";
import { newUser, seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// Runs only in the "hub" project. Rows are never deleted, so expected totals are read back from the database.

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function expectedCosts(now: Date) {
  const thisStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const lastStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const service = serviceClient();
  const usage = await service.from("ai_usage").select("cost_usd, at").eq("feature", "ideas").gte("at", new Date(lastStart).toISOString());
  if (usage.error) throw usage.error;
  let thisMonth = 0;
  let lastMonth = 0;
  for (const row of usage.data as { cost_usd: string | number; at: string }[]) {
    if (Date.parse(row.at) >= thisStart) thisMonth += Number(row.cost_usd);
    else lastMonth += Number(row.cost_usd);
  }
  const reviews = await service.from("idea_reviews").select("cost_usd").gte("created_at", new Date(thisStart).toISOString());
  if (reviews.error) throw reviews.error;
  const rows = reviews.data as { cost_usd: string | number }[];
  const perReview = rows.length ? usd(rows.reduce((s, r) => s + Number(r.cost_usd), 0) / rows.length) : "No reviews yet";
  return { thisMonth: usd(thisMonth), lastMonth: usd(lastMonth), perReview };
}

async function setGoogleRow(columns: Record<string, unknown>) {
  const { error } = await serviceClient().from("idea_google").update(columns).eq("id", true);
  if (error) throw error;
}

test.describe("ideas lab settings", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test("shows Google as not connected, this month's and last month's cost, cost per review and the cap", async ({ context, page }) => {
    await signInAs(context, await seededOwner());
    await setGoogleRow({ connected: false, calendar_id: null, connected_at: null, disconnected_at: null, oauth_state: null, oauth_state_at: null });
    const { error } = await serviceClient()
      .from("ai_usage")
      .insert({ feature: "ideas", model: "claude-haiku-5-5", input_tokens: 10, output_tokens: 5, cost_usd: 0.123456, purpose: "e2e" });
    if (error) throw error;
    const expected = await expectedCosts(new Date());

    await page.goto("/hub/ideas");
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/hub\/ideas\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

    const google = page.getByRole("region", { name: "Google Calendar" });
    await expect(google.getByText("Not connected.")).toBeVisible();
    await expect(google.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
    await expect(google.getByText("On your phone, open Google Calendar, Settings, and turn on sync for Ideas.")).toBeVisible();

    const costs = page.getByRole("region", { name: "Claude cost" });
    const value = (label: string) => costs.locator("div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd");
    await expect(value("This month")).toHaveText(expected.thisMonth);
    await expect(value("Last month")).toHaveText(expected.lastMonth);
    await expect(value("Cost per review")).toHaveText(expected.perReview);
    await expect(value("Monthly cap")).toHaveText("$25.00");
    expect(await page.content()).not.toMatch(/[\u2013\u2014]/);
  });

  test("Connect saves a state and sends the owner to Google's consent screen with the narrow scope", async ({ context, page }) => {
    await signInAs(context, await seededOwner());
    await setGoogleRow({ connected: false, oauth_state: null, oauth_state_at: null });
    await page.goto("/hub/ideas/settings");
    await expect(page.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
    // Posted directly without following the redirect: Playwright cannot stub a redirect hop, and the test must never reach Google.
    const origin = new URL(page.url()).origin;
    const res = await page.request.post("/hub/ideas/google/start", { headers: { origin }, maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(res.headers()["set-cookie"]).toMatch(/ideas_google_state=[A-Za-z0-9_-]{43};.*HttpOnly/i);

    const to = new URL(res.headers().location);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.app.created");
    expect(to.searchParams.get("access_type")).toBe("offline");
    expect(to.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+\/hub\/ideas\/google\/callback$/);
    const { data, error } = await serviceClient().from("idea_google").select("oauth_state").eq("id", true).single();
    if (error) throw error;
    expect((data as { oauth_state: string }).oauth_state).toBe(to.searchParams.get("state"));
  });

  test("a callback with a forged state answers 400 and connects nothing", async ({ context, page }) => {
    await signInAs(context, await seededOwner());
    await setGoogleRow({ connected: false, oauth_state: "a".repeat(43), oauth_state_at: new Date().toISOString() });
    const res = await page.goto(`/hub/ideas/google/callback?state=${"b".repeat(43)}&code=fake`);
    expect(res?.status()).toBe(400);
    const { data, error } = await serviceClient().from("idea_google").select("connected, oauth_state").eq("id", true).single();
    if (error) throw error;
    expect(data).toEqual({ connected: false, oauth_state: null });
  });

  test("anyone else signed in gets the not-found page from the settings page and both Google routes", async ({ context, page }) => {
    await signInAs(context, await newUser());
    await setGoogleRow({ oauth_state: "c".repeat(43), oauth_state_at: new Date().toISOString() });
    await page.goto("/hub/ideas/settings");
    await expect(page.getByText("Connect Google Calendar")).toHaveCount(0);
    const callback = await page.request.get(`/hub/ideas/google/callback?state=${"c".repeat(43)}&code=fake`, { maxRedirects: 0 });
    expect(callback.status()).toBe(404);
    const start = await page.request.post("/hub/ideas/google/start", { maxRedirects: 0 });
    expect(start.status()).toBe(404);
    const { data } = await serviceClient().from("idea_google").select("oauth_state").eq("id", true).single();
    expect((data as { oauth_state: string }).oauth_state).toBe("c".repeat(43));
  });
});
