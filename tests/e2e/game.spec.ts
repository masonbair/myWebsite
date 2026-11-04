import { expect, test, type Page } from "@playwright/test";

const circle = (page: Page) => page.getByRole("button", { name: "Catch the circle" });

async function startGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start the cat game" }).click();
}

async function catchCircles(page: Page, n: number, check?: () => Promise<void>) {
  for (let i = 0; i < n; i++) {
    await expect(circle(page)).toBeVisible();
    await check?.();
    await circle(page).click();
  }
}

// A reused dev server may have real Supabase env, so tests never let the API through.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/leaderboard", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
});

test("clicking circles raises score", async ({ page }) => {
  await startGame(page);
  await catchCircles(page, 4);
  await expect(page.getByTestId("score")).toHaveText("4");
  await expect(page.locator("[data-cat]")).toHaveAttribute("data-stage", "2");
});

test("circle stays in viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone-width check");
  test.setTimeout(60_000);
  await startGame(page);
  const nav = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  await catchCircles(page, 10, async () => {
    // Poll so the box is read after the scale-in settles.
    await expect.poll(async () => (await circle(page).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    const box = (await circle(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(812);
    expect(box.y).toBeGreaterThan(nav!.y + nav!.height);
  });
});

test("local leaderboard saves", async ({ page }) => {
  await startGame(page);
  await catchCircles(page, 2);
  await page.getByRole("button", { name: /leaderboard/i }).click();
  await page.getByLabel("Your name").fill("Tester");
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByRole("list", { name: "Top scores" }).getByText("Tester")).toBeVisible();
  await expect(page.getByText("Couldn't reach the leaderboard. Saved on this device.")).toBeVisible();
});

test("shared leaderboard shows and saves server scores", async ({ page }) => {
  let posted: unknown = null;
  await page.route("**/api/leaderboard", (route) => {
    if (route.request().method() === "POST") {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { entries: [{ name: "Tester", score: 2 }, { name: "Remote", score: 1 }] } });
    }
    return route.fulfill({ json: { entries: [{ name: "<b>Remote</b>", score: 1 }] } });
  });
  await startGame(page);
  await catchCircles(page, 2);
  await page.getByRole("button", { name: /leaderboard/i }).click();
  const list = page.getByRole("list", { name: "Top scores" });
  await expect(list.getByText("<b>Remote</b>")).toBeVisible();
  await expect(page.getByText("Scores are shared with everyone.")).toBeVisible();
  await page.getByLabel("Your name").fill("Tester");
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(list.getByText("Tester")).toBeVisible();
  expect(posted).toEqual({ name: "Tester", score: 2 });
});

test("rejected names show a plain message", async ({ page }) => {
  await page.route("**/api/leaderboard", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 400, json: { error: "offensive_name" } })
      : route.fulfill({ json: { entries: [] } }),
  );
  await startGame(page);
  await catchCircles(page, 1);
  await page.getByRole("button", { name: /leaderboard/i }).click();
  await page.getByLabel("Your name").fill("Rude");
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByText("That name isn't allowed. Try another one.")).toBeVisible();
});

test("game can be paused", async ({ page }) => {
  await startGame(page);
  await expect(circle(page)).toBeVisible();
  await page.getByRole("button", { name: "Pause the cat game" }).click();
  await expect(circle(page)).toHaveCount(0);
});

test("live circle stays on screen after a resize", async ({ page }) => {
  await startGame(page);
  // Catch until a circle sits low enough that the smaller viewport would cut it off.
  const size = { width: 340, height: 320 };
  for (let i = 0; i < 15; i++) {
    await expect(circle(page)).toBeVisible();
    await expect.poll(async () => (await circle(page).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    const box = (await circle(page).boundingBox())!;
    if (box.y + box.height > size.height + 20) break;
    await circle(page).click();
  }
  await page.setViewportSize(size);
  const nav = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await circle(page).boundingBox())!;
      return (
        box.x >= 0 &&
        box.y > nav.y + nav.height &&
        box.x + box.width <= size.width &&
        box.y + box.height <= size.height
      );
    })
    .toBe(true);
});

test("keyboard play keeps focus on the circles", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start the cat game" }).focus();
  await page.keyboard.press("Enter");
  await expect(circle(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("score")).toHaveText("1");
  await expect(circle(page)).toBeFocused();
});

test("leaderboard moves focus in and back", async ({ page }) => {
  await page.goto("/");
  const pill = page.getByRole("button", { name: /^Score \d+, leaderboard$/ });
  await pill.click();
  await expect(page.getByRole("button", { name: "Close leaderboard" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Leaderboard" })).toHaveCount(0);
  await expect(pill).toBeFocused();
});

test("pill clicked before the game loads still opens the leaderboard", async ({ page }) => {
  // Hold back chunks requested after load, which is when the game island is fetched.
  let loaded = false;
  page.on("load", () => (loaded = true));
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (loaded) await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Score 0, leaderboard" }).click();
  await expect(page.getByRole("button", { name: "Close leaderboard" })).toBeFocused();
});

test("keyboard focus stays on the pill when the game loads", async ({ page }) => {
  // Hold back the game so focus lands on the static pill first.
  let loaded = false;
  page.on("load", () => (loaded = true));
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (loaded) await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto("/");
  const pill = page.getByRole("button", { name: /^Score \d+, leaderboard$/ });
  await pill.focus();
  await expect(page.getByRole("button", { name: "Start the cat game" })).toBeVisible();
  await expect(pill).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Leaderboard" })).toHaveCount(0);
});

test("a failed game download retries on the next click", async ({ page, request }) => {
  // Chunk names are hashed, so any script the first HTML doesn't name is a lazy chunk, i.e. the game.
  // Scripts only: Turbopack never retries a failed CSS chunk, so that case can't recover in-page.
  const html = await (await request.get("/")).text();
  await page.route("**/_next/static/chunks/**/*.js", (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    const lazy = !html.includes(file) && !html.includes(decodeURIComponent(file)) && !file.includes("hmr-client");
    return lazy ? route.abort() : route.continue();
  });
  await page.goto("/");
  await page.waitForLoadState("load");
  // Long enough for the idle-time import to fail, short of the 4 s fallback.
  await page.waitForTimeout(1500);
  await page.unroute("**/_next/static/chunks/**/*.js");
  await expect(page.getByRole("button", { name: "Start the cat game" })).toHaveCount(0);
  await page.getByRole("button", { name: "Score 0, leaderboard" }).click();
  await expect(page.getByRole("dialog", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start the cat game" })).toBeVisible();
});

test("the game is home only: /coffee has no cat, no score pill, and no nav gap", async ({ page }, testInfo) => {
  await page.goto("/coffee");
  await page.waitForLoadState("load");
  // Past the 4 s fallback, so a game that loads late would be on the page by now.
  await page.waitForTimeout(4500);
  await expect(page.getByRole("button", { name: "Start the cat game" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /leaderboard/i })).toHaveCount(0);
  await expect(page.getByTestId("score")).toHaveCount(0);
  if (testInfo.project.name === "desktop") {
    const nav = page.getByRole("navigation", { name: "Main" });
    const gap = await nav.evaluate((el) => el.getBoundingClientRect().right - el.querySelector("ul")!.getBoundingClientRect().right);
    // Only the nav's own 8 px right padding, no empty slot where the pill was.
    expect(gap).toBeLessThanOrEqual(9);
  }
});
