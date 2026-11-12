import { createPrivateKey, createPublicKey, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { FIXTURES, fixturePort, type Fixture } from "./tests/e2e/fixture-servers";
import {
  HUB_ANTHROPIC_STUB_PORT,
  HUB_E2E_AGENT_TOKEN,
  HUB_E2E_MEMO_TOKEN,
  HUB_E2E_WORKER_TOKEN,
  HUB_LIVE_PORT,
  HUB_PORT,
  LEARN_E2E_FOCUSLOCK_TOKEN,
  LEARN_E2E_HINOTE_TOKEN,
  LEARN_E2E_ROUTINE_TOKEN,
} from "./tests/e2e/hub-ports";
import { localSupabaseEnv } from "./tests/e2e/local-supabase";

// Set once in the main process so workers, which reload this file, inherit the same values. Learn rows are never deleted,
// so each run gets its own far-future "today"; the signing seed lives only in this process's environment.
process.env.LEARN_E2E_TODAY ??= new Date(Date.UTC(2100, 0, 1) + randomInt(0, 300 * 365) * 86_400_000).toISOString().slice(0, 10);
process.env.LEARN_E2E_SEED ??= randomBytes(32).toString("base64");
process.env.LEARN_E2E_PUBLIC_KEY ??= createPublicKey(
  createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(process.env.LEARN_E2E_SEED, "base64")]),
    format: "der",
    type: "pkcs8",
  }),
)
  .export({ format: "der", type: "spki" })
  .subarray(12)
  .toString("base64");

const PORT = 3100;
const HUB_SPECS = /(^|\/)hub-[^/]*\.spec\.ts$/;
// Each dev server is slow to start on a busy machine, so a run starts only the set it needs.
const SERVER_SETS = ["hub", "site"] as const;
type ServerSet = (typeof SERVER_SETS)[number];
const SERVER_TIMEOUT = 300_000;

function selectedServerSets(): readonly ServerSet[] {
  const value = process.env.E2E_SERVERS;
  if (!value) return SERVER_SETS;
  if (!(SERVER_SETS as readonly string[]).includes(value)) {
    throw new Error(`E2E_SERVERS must be one of ${SERVER_SETS.join(", ")} or unset, got "${value}"`);
  }
  return [value as ServerSet];
}

const serverSets = selectedServerSets();

// Next rewrites the tsconfig it is given to include its distDir, so each fixture
// server gets a throwaway tsconfig in .next instead of dirtying the real one.
function fixtureTsconfig(f: Fixture | "hub" | "hub-live"): string {
  mkdirSync(".next/e2e-tsconfig", { recursive: true });
  const file = `.next/e2e-tsconfig/${f}.json`;
  // Workers reload this config; rewriting while a server runs would make it restart.
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ extends: "../../tsconfig.json" }));
  return file;
}

// Each fixture gets its own dev server: NOW_FIXTURE is read from process env, and
// its own distDir because Next allows only one dev server per build folder.
const fixtureServers = FIXTURES.map((f) => ({
  command: `npx next dev -p ${fixturePort(f)}`,
  url: `http://localhost:${fixturePort(f)}`,
  // Never reuse: a stray server on this port could have the real GitHub token.
  reuseExistingServer: false,
  timeout: SERVER_TIMEOUT,
  env: {
    // The github server shows the full board plus fixture GitHub data.
    NOW_FIXTURE: f === "github" ? "full.json" : `${f}.json`,
    // Only the full and empty boards read trends, so the other fixture boards keep their tile layouts.
    TRENDS_FIXTURE: f === "full" ? "trends.json" : f === "empty" ? "empty.json" : "",
    GITHUB_TOKEN: "",
    SUPABASE_URL: "",
    // With no database, the board's time-of-day tint falls back to this zone.
    HUB_TIME_ZONE: "Europe/Lisbon",
    ...(f === "github" ? { GITHUB_FIXTURE: "github-graphql.json" } : {}),
    NEXT_DIST_DIR: `.next/e2e-${f}`,
    NEXT_TSCONFIG: fixtureTsconfig(f),
  },
}));

// Hub specs need a real Supabase, so their server gets the local stack, never the live one.
const localSupabase = localSupabaseEnv();

function hubServer(port: number, name: "hub" | "hub-live", workerLive: boolean) {
  return {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: SERVER_TIMEOUT,
    env: {
      GITHUB_TOKEN: "",
      NEXT_PUBLIC_SUPABASE_URL: localSupabase.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabase.anonKey,
      SUPABASE_URL: localSupabase.url,
      SUPABASE_SERVICE_ROLE_KEY: localSupabase.serviceKey,
      HUB_OWNER_GITHUB_ID: "77211262",
      HUB_WORKER_TOKEN: HUB_E2E_WORKER_TOKEN,
      MEMO_UPLOAD_TOKEN: HUB_E2E_MEMO_TOKEN,
      HUB_AGENT_TOKEN: HUB_E2E_AGENT_TOKEN,
      // Fake Google keys so the settings page shows Connect; specs read the start redirect without following it, so nothing reaches Google.
      GOOGLE_OAUTH_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "e2e-client-secret",
      IDEAS_MONTHLY_BUDGET_USD: "25",
      ANALYTICS_SALT: "analytics-e2e-salt-local-only",
      // Learn grades against the local stub, never Claude; the date, key and tokens exist only for this run.
      ANTHROPIC_API_KEY_LEARN: "e2e-local-only",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${HUB_ANTHROPIC_STUB_PORT}`,
      LEARN_E2E_TODAY: process.env.LEARN_E2E_TODAY!,
      LEARN_GRANT_PRIVATE_KEY: process.env.LEARN_E2E_SEED!,
      LEARN_FOCUSLOCK_TOKEN: LEARN_E2E_FOCUSLOCK_TOKEN,
      LEARN_HINOTE_TOKEN: LEARN_E2E_HINOTE_TOKEN,
      LEARN_ROUTINE_TOKEN: LEARN_E2E_ROUTINE_TOKEN,
      // Set explicitly so a value in .env.local can never decide which state a test sees.
      HUB_WORKER_LIVE: workerLive ? "true" : "false",
      // Only the live server registers the service worker, so the other hub specs never run behind one.
      NEXT_PUBLIC_HUB_SW: workerLive ? "1" : "",
      NEXT_DIST_DIR: `.next/e2e-${name}`,
      NEXT_TSCONFIG: fixtureTsconfig(name),
    },
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: "desktop",
      testIgnore: HUB_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      testIgnore: HUB_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "hub",
      testMatch: HUB_SPECS,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${HUB_PORT}` },
    },
  ],
  webServer: [
    ...(serverSets.includes("site")
      ? [
          {
            command: `npx next dev -p ${PORT}`,
            url: `http://localhost:${PORT}`,
            // Never reuse: a stray server here could have the real GitHub token or Supabase keys.
            reuseExistingServer: false,
            timeout: SERVER_TIMEOUT,
            // Empty beats .env.local, so e2e never calls live GitHub or writes to the real leaderboard.
            env: { GITHUB_TOKEN: "", SUPABASE_URL: "" },
          },
          ...fixtureServers,
        ]
      : []),
    ...(serverSets.includes("hub")
      ? [
          {
            command: "node tests/e2e/anthropic-stub.mjs",
            url: `http://127.0.0.1:${HUB_ANTHROPIC_STUB_PORT}`,
            reuseExistingServer: false,
            timeout: 30_000,
            env: { HUB_ANTHROPIC_STUB_PORT: String(HUB_ANTHROPIC_STUB_PORT) },
          },
          hubServer(HUB_PORT, "hub", false),
          hubServer(HUB_LIVE_PORT, "hub-live", true),
        ]
      : []),
  ],
});
