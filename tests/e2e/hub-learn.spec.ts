import { createPublicKey, randomUUID, verify } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LEARN_E2E_FOCUSLOCK_TOKEN, LEARN_E2E_HINOTE_TOKEN, LEARN_E2E_ROUTINE_TOKEN } from "./hub-ports";
import { seededOwner, serviceClient, signInAs, supabase } from "./hub-session";

// Learn rows can never be deleted, so playwright.config.ts gives every run its own far-future "today".
const TODAY = process.env.LEARN_E2E_TODAY!;
const PUBLIC_KEY = process.env.LEARN_E2E_PUBLIC_KEY!;
const EXPLAIN_ID = randomUUID();
const VOICE_ID = randomUUID();

test.describe.configure({ mode: "serial" });
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

function publicKey() {
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(PUBLIC_KEY, "base64")]), format: "der", type: "spki" });
}

async function openAnswer(page: Page, card: 1 | 2) {
  await page.goto("/hub/learn");
  if (card === 2) await page.getByRole("button", { name: "Next card" }).last().click();
  await expect(page.getByText(`Card ${card} of 2`)).toBeVisible();
  await page.getByRole("tab", { name: "2 · Answer" }).click();
}

test.describe("learn page", () => {
  test.skip(!supabase.url, "needs local Supabase running (supabase start)");

  test.beforeAll(async () => {
    const base = { date: TODAY, reading_title: "The curse of knowledge", reading_url: "https://hbr.org/2006/12/the-curse-of-knowledge", model: "claude-sonnet-5-5" };
    const { error } = await serviceClient()
      .from("learn_exercises")
      .insert([
        {
          ...base,
          id: EXPLAIN_ID,
          position: 1,
          type: "explain",
          topic: "explain-simply",
          question: "Rosa asks why her bakery site was down for an hour after the move. Explain it in three sentences.",
          client: "Rosa, who runs a bakery",
          reading_summary: "Experts forget what it was like not to know.",
          reading_why: "You open with tool names.",
        },
        {
          ...base,
          id: VOICE_ID,
          position: 2,
          type: "voice",
          topic: "communication",
          question: "Record a one-minute voice note telling a client their launch slips a week.",
          reading_summary: "Lead with the news, then the plan.",
        },
      ]);
    expect(error).toBeNull();
  });

  test("signed out, /hub/learn goes to the login page", async ({ page }) => {
    await page.goto("/hub/learn");
    await expect(page).toHaveURL(/\/hub\/login/);
  });

  test.describe("as the owner", () => {
    test.beforeEach(async ({ context }) => {
      await signInAs(context, await seededOwner());
    });

    test("shows card 1 on its Read side, switches sides with the keyboard, and has no serious axe issues", async ({ page }) => {
      await page.goto("/hub/learn");
      await expect(page.getByRole("heading", { level: 1, name: "Today's practice" })).toBeVisible();
      await expect(page.getByText("Card 1 of 2")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "The curse of knowledge" })).toBeVisible();
      await page.getByRole("tab", { name: "1 · Read" }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "2 · Answer" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { level: 2, name: /Rosa asks why/ })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    });

    test("grades a typed answer once and adds its minutes", async ({ page, context }) => {
      const second = await context.newPage();
      await openAnswer(second, 1);
      await openAnswer(page, 1);
      await page.getByLabel("Your answer").fill("Your site moved to a new home, and its new address took about an hour to reach everyone.");
      await page.getByRole("button", { name: "Send for grading" }).click();
      await expect(page.getByText("Graded: A- · +4 min")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("learn-earned")).toHaveText("+4 / 10 min");

      await second.getByLabel("Your answer").fill("Another try.");
      await second.getByRole("button", { name: "Send for grading" }).click();
      await expect(second.getByRole("alert").filter({ hasText: "Already answered." })).toBeVisible();
    });

    test("an accepted reading takeaway earns a minute", async ({ page }) => {
      await page.goto("/hub/learn");
      await page.getByLabel("One line: what did you take from it?").fill("STUB-ACCEPT tappers think half know the song; 2.5% do.");
      await page.getByRole("button", { name: "I read it" }).click();
      await expect(page.getByRole("status").filter({ hasText: "+1 min" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("learn-earned")).toHaveText("+5 / 10 min");
    });

    test("records a voice note, the phone transcribes it, and the report shows delivery", async ({ page, request }) => {
      // Recording, upload, and grading in after() on a cold dev server take longer than the 30 s default.
      test.setTimeout(120_000);
      await openAnswer(page, 2);
      await page.getByRole("button", { name: "Answer with a voice note" }).click();
      await expect(page.getByText(/Recording · \d+s/)).toBeVisible();
      await page.waitForTimeout(2200);
      await page.getByRole("button", { name: "Stop recording" }).click();
      await expect(page.getByText("Voice note ready.")).toBeVisible();
      await page.getByRole("button", { name: "Send for grading" }).click();
      await expect(page.getByText("Voice note sent. Graded soon.")).toBeVisible({ timeout: 30_000 });

      const hinote = { authorization: `Bearer ${LEARN_E2E_HINOTE_TOKEN}` };
      const pending = await (await request.get("/api/learn/voice/pending", { headers: hinote })).json();
      const clip = pending.clips.find((c: { url: string }) => c.url.includes(`answers/${VOICE_ID}`));
      expect(clip).toBeTruthy();
      const audio = await request.get(clip.url);
      expect(audio.ok()).toBe(true);
      expect((await audio.body()).length).toBeGreaterThan(0);

      const path = `/api/learn/voice/${clip.id}/transcript`;
      expect((await request.post(path, { headers: hinote, data: { transcript: "um so the idea is the launch moves a week" } })).status()).toBe(204);
      expect((await request.post(path, { headers: hinote, data: { transcript: "again" } })).status()).toBe(409);

      await expect
        .poll(
          async () => {
            await openAnswer(page, 2);
            return page.getByRole("heading", { level: 3, name: "Delivery" }).isVisible();
          },
          { timeout: 60_000, intervals: [2000] },
        )
        .toBe(true);
    });

    test("Focus Lock gets only signed grants for the asked day, inside the cap", async ({ request }) => {
      const focus = { authorization: `Bearer ${LEARN_E2E_FOCUSLOCK_TOKEN}` };
      const res = await request.get(`/api/learn/grants?date=${TODAY}`, { headers: focus });
      expect(res.status()).toBe(200);
      const { grants } = (await res.json()) as { grants: { msg: string; sig: string }[] };
      expect(grants.length).toBeGreaterThan(0);
      const key = publicKey();
      let total = 0;
      const nonces = new Set<string>();
      for (const g of grants) {
        expect(verify(null, Buffer.from(g.msg, "utf8"), key, Buffer.from(g.sig, "base64"))).toBe(true);
        const [, date, pkg, minutes, nonce] = g.msg.split("|");
        expect(date).toBe(TODAY);
        expect(pkg).toBe("com.instagram.android");
        total += Number(minutes);
        nonces.add(nonce);
      }
      expect(total).toBeLessThanOrEqual(10);
      expect(nonces.size).toBe(grants.length);

      expect((await request.get(`/api/learn/grants?date=${TODAY}`, { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
      expect((await request.get("/api/learn/grants", { headers: focus })).status()).toBe(400);
    });

    test("phone screenshots in light and dark", async ({ page }) => {
      const dir = process.env.LEARN_E2E_SHOTS;
      test.skip(!dir, "set LEARN_E2E_SHOTS to a folder to save screenshots");
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/hub/learn");
        await expect(page.getByText("Card 1 of 2")).toBeVisible();
        await page.screenshot({ path: `${dir}/learn-read-${scheme}.png`, fullPage: true });
        await page.getByRole("tab", { name: "2 · Answer" }).click();
        await page.screenshot({ path: `${dir}/learn-report-${scheme}.png`, fullPage: true });
        await page.getByRole("button", { name: "Next card" }).last().click();
        await page.getByRole("tab", { name: "2 · Answer" }).click();
        await page.screenshot({ path: `${dir}/learn-voice-report-${scheme}.png`, fullPage: true });
      }
    });

    test("the Daily Learn routine reads today's two exercises", async ({ request }) => {
      const res = await request.get("/api/learn/today", { headers: { authorization: `Bearer ${LEARN_E2E_ROUTINE_TOKEN}` } });
      const body = await res.json();
      expect(body.date).toBe(TODAY);
      expect(body.hubUrl).toBe("https://masonbair.com/hub/learn");
      expect(body.exercises.map((e: { type: string; topic: string }) => [e.type, e.topic])).toEqual([
        ["explain", "Explaining technical things simply"],
        ["voice", "Communication"],
      ]);
    });
  });
});
