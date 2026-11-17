import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { HUB_E2E_AGENT_TOKEN, HUB_PORT } from "./hub-ports";
import { seededOwner, signInAs, supabase } from "./hub-session";

test.skip(!supabase.url, "needs a running local Supabase");

const dir = mkdtempSync(join(tmpdir(), "hub-sessions-"));
const tokenFile = join(dir, "token");
writeFileSync(tokenFile, `${HUB_E2E_AGENT_TOKEN}\n`);

// Runs the real laptop hook against the local hub server; the anthropic stub queues a turn whose text has STUB-QUEUE.
function hook(input: Record<string, unknown>) {
  execFileSync("bash", ["hub/hooks/hub-session.sh"], {
    input: JSON.stringify(input),
    env: { ...process.env, HUB_SESSION_URL: `http://localhost:${HUB_PORT}/api/hub/sessions`, HUB_SESSION_TOKEN_FILE: tokenFile },
  });
}

test("a big turn reaches the Sessions page, a small one does not, and a reply clears it", async ({ page, context }) => {
  const big = `e2e-${randomUUID()}`;
  const small = `e2e-${randomUUID()}`;
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "user", message: { content: "build the queue STUB-QUEUE" } })}\n`);
  hook({ hook_event_name: "Stop", session_id: big, cwd: process.cwd(), transcript_path: transcript, last_assistant_message: "Built it. Merge?" });
  hook({ hook_event_name: "Stop", session_id: small, cwd: "/tmp", last_assistant_message: "Fixed a typo." });

  await signInAs(context, await seededOwner());
  await page.goto("/hub/sessions");
  const row = page.getByRole("listitem").filter({ hasText: "Session queue built; needs your OK to merge." });
  await expect(row.first()).toBeVisible();
  await expect(row.first().getByText("Needs you", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");
  const before = await row.count();

  hook({ hook_event_name: "UserPromptSubmit", session_id: big, cwd: process.cwd() });
  await page.reload();
  await expect(row).toHaveCount(before - 1);
});

test("signed out, /hub/sessions goes to the login page", async ({ page }) => {
  await page.goto("/hub/sessions");
  await expect(page).toHaveURL(/\/hub\/login/);
});
