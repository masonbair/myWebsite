import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { HUB_LIVE_PORT } from "./hub-ports";
import { ownerDbClient, seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// Runs only in the "hub" project against local Supabase. Rows can never be deleted, so titles are unique per run.

type Seed = {
  title?: string;
  list?: "inbox" | "todo" | "ideas";
  labels?: string[];
  state?: "open" | "archived";
  mergedInto?: string;
};

// Seeded as the owner, since the database refuses the claude label from the service role.
async function seedItem(seed: Seed = {}) {
  const title = seed.title ?? `e2e ${randomUUID().slice(0, 8)}`;
  const { data, error } = await (await ownerDbClient())
    .from("items")
    .insert({
      title,
      list: seed.list ?? "inbox",
      labels: seed.labels ?? [],
      state: seed.state ?? "open",
      archived_reason: seed.state === "archived" ? "merged" : null,
      merged_into: seed.mergedInto ?? null,
      source: "e2e",
    })
    .select("id, title")
    .single();
  if (error) throw error;
  return data as { id: string; title: string };
}

async function itemRow(id: string) {
  const { data, error } = await serviceClient().from("items").select("state, labels, list, due_date").eq("id", id).single();
  if (error) throw error;
  return data as { state: string; labels: string[]; list: string; due_date: string | null };
}

test.describe("hub pages", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test.beforeEach(async ({ context }) => {
    await signInAs(context, await seededOwner());
  });

  test("inbox shows unsorted items, then items that need Mason from any list", async ({ page }) => {
    const unsorted = await seedItem({ list: "inbox" });
    const question = await seedItem({ list: "todo", labels: ["claude", "claude-question"] });
    const finished = await seedItem({ list: "ideas", labels: ["claude", "claude-done"] });
    const sortedTodo = await seedItem({ list: "todo" });

    await page.goto("/hub");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    const inbox = page.getByRole("region", { name: "Unsorted" });
    const needsYou = page.getByRole("region", { name: "Needs you" });
    await expect(inbox.getByRole("link", { name: unsorted.title })).toBeVisible();
    await expect(needsYou.getByRole("link", { name: question.title })).toBeVisible();
    await expect(needsYou.getByRole("link", { name: finished.title })).toBeVisible();
    await expect(page.getByRole("link", { name: sortedTodo.title })).toHaveCount(0);

    const unsortedBox = await inbox.boundingBox();
    const needsYouBox = await needsYou.boundingBox();
    expect(unsortedBox!.y).toBeLessThan(needsYouBox!.y);
  });

  test("Done takes an item off its list and marks it done", async ({ page }) => {
    const item = await seedItem({ list: "todo" });
    await page.goto("/hub/list/todo");
    await expect(page.getByRole("heading", { level: 1, name: "Todo" })).toBeVisible();
    await expect(page.getByRole("link", { name: item.title })).toBeVisible();
    await page.getByRole("button", { name: `Mark ${item.title} done` }).click();
    await expect(page.getByRole("link", { name: item.title })).toHaveCount(0);
    expect((await itemRow(item.id)).state).toBe("done");
  });

  test("an item page can be marked done and reopened", async ({ page }) => {
    const item = await seedItem({ list: "ideas" });
    await page.goto(`/hub/item/${item.id}`);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    expect((await itemRow(item.id)).state).toBe("done");
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    expect((await itemRow(item.id)).state).toBe("open");
  });

  test("without the live worker there is no Approve button", async ({ page }) => {
    const item = await seedItem({ list: "todo" });
    await page.goto(`/hub/item/${item.id}`);
    await expect(page.getByRole("heading", { level: 1, name: item.title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("with the live worker, Approve adds the claude label", async ({ page }) => {
    const item = await seedItem({ list: "todo" });
    await page.goto(`http://localhost:${HUB_LIVE_PORT}/hub/item/${item.id}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Labels" }).getByText("claude", { exact: true })).toBeVisible();
    expect((await itemRow(item.id)).labels).toContain("claude");
  });

  test("a worker comment shows on the item page with its first line bold", async ({ page }) => {
    const item = await seedItem({ list: "todo", labels: ["claude", "claude-done"] });
    const headline = `Found two flights ${randomUUID().slice(0, 6)}`;
    const { error } = await serviceClient()
      .from("comments")
      .insert({ item_id: item.id, author: "worker", body: `${headline}\nThe cheaper one leaves at 9am.` });
    expect(error).toBeNull();

    await page.goto(`/hub/item/${item.id}`);
    const thread = page.getByRole("region", { name: "Comments" });
    await expect(thread.locator("strong", { hasText: headline })).toBeVisible();
    await expect(thread.getByText("The cheaper one leaves at 9am.")).toBeVisible();
  });

  test("Mason can comment, label, date and move an item", async ({ page }) => {
    const item = await seedItem({ list: "inbox" });
    await page.goto(`/hub/item/${item.id}`);

    await page.getByLabel("Add a comment").fill("Ask Sam first");
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByRole("region", { name: "Comments" }).getByText("Ask Sam first")).toBeVisible();

    await page.getByLabel("New label").fill("laptop");
    await page.getByRole("button", { name: "Add label" }).click();
    await expect(page.getByRole("list", { name: "Labels" }).getByText("laptop", { exact: true })).toBeVisible();

    await page.getByLabel("Due date").fill("2026-11-20");
    await page.getByRole("button", { name: "Save date" }).click();
    await expect(page.getByText("Due Fri, Nov 20")).toBeVisible();

    await page.getByLabel("List", { exact: true }).selectOption("todo");
    await expect(page.getByRole("main").getByRole("link", { name: "Todo", exact: true })).toBeVisible();
    await expect.poll(async () => (await itemRow(item.id)).list).toBe("todo");

    const saved = await itemRow(item.id);
    expect(saved.labels).toContain("laptop");
    expect(saved.due_date).toBe("2026-11-20");
  });

  test("an archived item is hidden from lists and linked from the item it merged into", async ({ page }) => {
    const survivor = await seedItem({ list: "todo" });
    const merged = await seedItem({ list: "todo", state: "archived", mergedInto: survivor.id });

    await page.goto("/hub/list/todo");
    await expect(page.getByRole("link", { name: survivor.title })).toBeVisible();
    await expect(page.getByRole("link", { name: merged.title })).toHaveCount(0);

    await page.getByRole("link", { name: survivor.title }).click();
    const mergedFrom = page.getByRole("region", { name: "Merged from" });
    await mergedFrom.getByRole("link", { name: merged.title }).click();
    await expect(page).toHaveURL(new RegExp(`/hub/item/${merged.id}$`));
    await expect(page.getByRole("link", { name: survivor.title })).toBeVisible();
  });

  test("typing claude in the label editor is refused while the worker is off", async ({ page }) => {
    const item = await seedItem({ list: "todo", labels: ["laptop"] });
    await page.goto(`/hub/item/${item.id}`);
    await page.getByLabel("New label").fill("claude");
    await page.getByRole("button", { name: "Add label" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not save. Try again." })).toBeVisible();
    expect((await itemRow(item.id)).labels).toEqual(["laptop"]);
  });

  test("an archived item page is read-only and points at the surviving item", async ({ page }) => {
    const survivor = await seedItem({ list: "todo" });
    const merged = await seedItem({ list: "todo", labels: ["laptop"], state: "archived", mergedInto: survivor.id });
    await page.goto(`/hub/item/${merged.id}`);
    await expect(page.getByText("Archived. It stays here for the record and cannot be changed.")).toBeVisible();
    await expect(page.getByRole("link", { name: survivor.title })).toBeVisible();
    await expect(page.getByRole("list", { name: "Labels" }).getByText("laptop")).toBeVisible();
    for (const control of ["Done", "Reopen", "Approve", "Add label", "Save date", "Post"]) {
      await expect(page.getByRole("button", { name: control, exact: true })).toHaveCount(0);
    }
    await expect(page.getByLabel("List", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Comments" })).toBeVisible();
  });

  test("the hub has its own header, not the public site nav, and Sign out ends the session", async ({ page }) => {
    await page.goto("/hub");
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "About", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Mason's hub", exact: true })).toHaveAttribute("href", "/hub");
    await expect(page.getByRole("link", { name: "Site" })).toHaveAttribute("href", "/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/hub\/login$/);
    await page.goto("/hub");
    await expect(page).toHaveURL(/\/hub\/login$/);
  });

  test("an item rewritten by the worker shows its earlier text, collapsed", async ({ page }) => {
    const item = await seedItem({ list: "todo" });
    const { error } = await serviceClient().from("items").update({ title: `${item.title} reworded` }).eq("id", item.id);
    if (error) throw error;

    await page.goto(`/hub/item/${item.id}`);
    await expect(page.getByRole("heading", { level: 1, name: `${item.title} reworded` })).toBeVisible();
    const earlier = page.getByText("Earlier versions");
    await expect(earlier).toBeVisible();
    const oldTitle = page.getByText(item.title, { exact: true });
    await expect(oldTitle).toBeHidden();
    await earlier.click();
    await expect(oldTitle).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });

  test("an unknown list or item is a 404", async ({ page }) => {
    expect((await page.goto("/hub/list/someday"))?.status()).toBe(404);
    expect((await page.goto(`/hub/item/${randomUUID()}`))?.status()).toBe(404);
    expect((await page.goto("/hub/item/not-a-uuid"))?.status()).toBe(404);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`inbox and item pages have no serious a11y violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const item = await seedItem({ list: "inbox", labels: ["claude", "claude-question"] });
      await page.goto("/hub");
      await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await page.goto(`/hub/item/${item.id}`);
      await expect(page.getByRole("heading", { level: 1, name: item.title })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  }
});

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }));
}
