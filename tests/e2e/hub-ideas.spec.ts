import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ownerDbClient, seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// Runs only in the "hub" project against local Supabase. Rows can never be deleted, so titles are unique per run.

type Settings = Record<string, unknown>;

function review(verdict: string, extra: Record<string, unknown> = {}) {
  return {
    verdict,
    why: `Why ${verdict}: people already ask for this.`,
    audience: "Travelers who bake on the road",
    existing: [
      { name: "Safe Tool", url: "https://example.com/tool", difference: "Only works on desktop" },
      { name: "Bad Tool", url: "javascript:alert(1)", difference: "Has a bad link" },
    ],
    fromMemoryOnly: false,
    weakSpots: [
      { problem: "Hard to find users", fix: "Post in two baking forums" },
      { problem: "Costs to host", fix: "Start as a static page" },
    ],
    variations: ["A phone-only version", "A printed card"],
    weekend: { build: "One page with a form", signal: "Ten sign ups in a week" },
    links: [],
    ...extra,
  };
}

// Owner inserts the item (source e2e, so the capture intake stays out); the service role writes the job's columns.
async function seedIdea(opts: { list?: "ideas" | "todo"; settings?: Settings | null; reviews?: unknown[] } = {}) {
  const title = `e2e idea ${randomUUID().slice(0, 8)}`;
  const { data, error } = await (await ownerDbClient())
    .from("items")
    .insert({ title, description: "An idea for the e2e run.", list: opts.list ?? "ideas", labels: ["idea"], source: "e2e" })
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const service = serviceClient();
  if (opts.settings !== null) {
    const { error: settingsError } = await service
      .from("idea_settings")
      .insert({ item_id: id, enrolled: true, review_status: "done", ...(opts.settings ?? {}) });
    if (settingsError) throw settingsError;
  }
  for (const [index, body] of (opts.reviews ?? []).entries()) {
    const { error: reviewError } = await service.from("idea_reviews").insert({
      item_id: id,
      version: index + 1,
      review: body,
      model: "claude-opus-5-5",
      prompt_version: "review-v1",
      cost_usd: 0.2,
    });
    if (reviewError) throw reviewError;
  }
  return { id, title };
}

async function settingsRow(id: string) {
  const { data, error } = await serviceClient().from("idea_settings").select("*").eq("item_id", id).single();
  if (error) throw error;
  return data as Settings;
}

test.describe("ideas lab", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test.beforeEach(async ({ context }) => {
    await signInAs(context, await seededOwner());
  });

  test("the list shows title, verdict, mentions and review marks", async ({ page }) => {
    const strong = await seedIdea({ settings: { mention_count: 3 }, reviews: [review("strong")] });
    const waiting = await seedIdea({ settings: { review_status: "waiting" } });
    const failed = await seedIdea({ settings: { review_status: "failed", last_error: "schema" } });

    await page.goto("/hub/ideas");
    await expect(page.getByRole("heading", { level: 1, name: "Ideas Lab" })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: strong.title });
    await expect(row.getByRole("link", { name: strong.title })).toHaveAttribute("href", `/hub/ideas/${strong.id}`);
    await expect(row.getByText("strong", { exact: true })).toBeVisible();
    await expect(row.getByText("mentioned 3 times")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: waiting.title }).getByText("Review waiting")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: failed.title }).getByText("Review failed")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ideas", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("filters move stopped and promoted ideas off the active list", async ({ page }) => {
    const stopped = await seedIdea({ settings: { reminders_stopped_at: new Date().toISOString() } });
    const promoted = await seedIdea({ list: "todo" });
    await page.goto("/hub/ideas");
    await expect(page.getByText(stopped.title)).toHaveCount(0);
    await expect(page.getByText(promoted.title)).toHaveCount(0);
    await page.getByRole("link", { name: "Stopped" }).click();
    await expect(page.getByRole("link", { name: stopped.title })).toBeVisible();
    await page.getByRole("link", { name: "Promoted" }).click();
    await expect(page.getByRole("link", { name: promoted.title })).toBeVisible();
  });

  test("the idea page shows the review, folds earlier versions and keeps links safe", async ({ page }) => {
    const idea = await seedIdea({ reviews: [review("weak"), review("promising"), { broken: true }] });
    await page.goto(`/hub/ideas/${idea.id}`);
    await expect(page.getByRole("heading", { level: 1, name: idea.title })).toBeVisible();
    await expect(page.getByText("Review could not be shown")).toBeVisible();

    const earlier = page.locator("details", { hasText: "Earlier reviews" });
    await expect(earlier).not.toHaveAttribute("open", /.*/);
    await earlier.locator("summary").click();
    await expect(earlier.getByText("Why promising: people already ask for this.")).toBeVisible();
    await expect(earlier.getByText("Why weak: people already ask for this.")).toBeVisible();
    await expect(earlier.getByText("Travelers who bake on the road").first()).toBeVisible();
    await expect(earlier.getByText("Post in two baking forums").first()).toBeVisible();
    await expect(earlier.getByText("Ten sign ups in a week").first()).toBeVisible();

    const safe = earlier.getByRole("link", { name: "Safe Tool" }).first();
    await expect(safe).toHaveAttribute("href", "https://example.com/tool");
    await expect(safe).toHaveAttribute("target", "_blank");
    await expect(safe).toHaveAttribute("rel", "noopener noreferrer");
    await expect(earlier.getByRole("link", { name: "Bad Tool" })).toHaveCount(0);
    await expect(earlier.getByText("Bad Tool").first()).toBeVisible();
  });

  test("Review again queues a review with the note", async ({ page }) => {
    const idea = await seedIdea({ reviews: [review("strong")] });
    await page.goto(`/hub/ideas/${idea.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "Review" })).toBeVisible();
    await page.getByLabel("Note for the review (optional)").fill("Look at pricing");
    await page.getByRole("button", { name: "Review again" }).click();
    await expect(page.getByText("Review waiting")).toBeVisible();
    await expect.poll(async () => (await settingsRow(idea.id)).review_status).toBe("waiting");
    expect(await settingsRow(idea.id)).toMatchObject({ review_note: "Look at pricing", enrolled: true, schedule_from: new Date().toISOString().slice(0, 10) });
  });

  test("an older idea that was never enrolled offers Review", async ({ page }) => {
    const idea = await seedIdea({ settings: null });
    await page.goto(`/hub/ideas/${idea.id}`);
    await expect(page.getByRole("button", { name: "Review again" })).toHaveCount(0);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByText("Review waiting")).toBeVisible();
    await expect(page.getByRole("button", { name: "Review again" })).toBeVisible();
    await expect.poll(async () => (await settingsRow(idea.id)).review_status).toBe("waiting");
  });

  test("a moved idea can go back to the inbox", async ({ page }) => {
    const idea = await seedIdea({ settings: { moved_from_inbox: true } });
    await page.goto(`/hub/ideas/${idea.id}`);
    await expect(page.getByText("Moved here from the inbox by the Ideas Lab")).toBeVisible();
    await page.getByRole("button", { name: "Back to inbox" }).click();
    await expect.poll(async () => {
      const { data } = await serviceClient().from("items").select("list, labels").eq("id", idea.id).single();
      return data;
    }).toEqual({ list: "inbox", labels: [] });
    expect((await settingsRow(idea.id)).reminders_stopped_at).not.toBeNull();
  });

  test("an idea that was not moved has no Back to inbox", async ({ page }) => {
    const idea = await seedIdea();
    await page.goto(`/hub/ideas/${idea.id}`);
    await expect(page.getByRole("heading", { level: 1, name: idea.title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to inbox" })).toHaveCount(0);
  });

  test("the old ideas list redirects to the Ideas Lab", async ({ page }) => {
    await page.goto("/hub/list/ideas");
    await expect(page).toHaveURL(/\/hub\/ideas$/);
  });

  test("an empty filter says so", async ({ page }) => {
    await page.goto("/hub/ideas?show=nothing-here");
    await expect(page.getByRole("heading", { level: 1, name: "Ideas Lab" })).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("an idea link goes through login and asks to come back", async ({ page, request }) => {
    const id = randomUUID();
    const res = await request.get(`/hub/ideas/${id}`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = new URL(res.headers().location, "http://x");
    expect(location.pathname).toBe("/hub/login");
    expect(location.searchParams.get("next")).toBe(`/hub/ideas/${id}`);

    test.skip(!supabase.url, "needs local Supabase running (supabase start)");
    // Local Supabase has no GitHub app, so stop at the authorize request and read where it would send Mason back.
    let authorize: URL | null = null;
    await page.route("**/auth/v1/authorize**", async (route) => {
      authorize = new URL(route.request().url());
      await route.fulfill({ status: 200, body: "stopped" });
    });
    await page.goto(`/hub/ideas/${id}`);
    await expect(page).toHaveURL(new RegExp(`/hub/login\\?next=%2Fhub%2Fideas%2F${id}$`));
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect.poll(() => authorize?.searchParams.get("redirect_to") ?? null).not.toBeNull();
    const back = new URL(authorize!.searchParams.get("redirect_to")!);
    expect(back.pathname).toBe("/hub/auth/callback");
    expect(back.searchParams.get("next")).toBe(`/hub/ideas/${id}`);
  });

  test("a hostile next is dropped on the login page", async ({ page }) => {
    test.skip(!supabase.url, "needs local Supabase running (supabase start)");
    let authorize: URL | null = null;
    await page.route("**/auth/v1/authorize**", async (route) => {
      authorize = new URL(route.request().url());
      await route.fulfill({ status: 200, body: "stopped" });
    });
    await page.goto("/hub/login?next=%2F%2Fevil.com");
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect.poll(() => authorize?.searchParams.get("redirect_to") ?? null).not.toBeNull();
    const back = new URL(authorize!.searchParams.get("redirect_to")!);
    expect(back.searchParams.get("next")).toBeNull();
  });

  test("the callback never sends you off the hub", async ({ request }) => {
    const res = await request.get("/hub/auth/callback?next=%2F%2Fevil.com", { maxRedirects: 0 });
    expect(new URL(res.headers().location).pathname).toBe("/hub/login");
    expect(res.headers().location).not.toContain("evil");
  });
});
