import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { FIXTURES, fixturePort, type Fixture } from "./tests/e2e/fixture-servers";
import { localSupabaseEnv } from "./tests/e2e/local-supabase";

const PORT = 3100;
const HUB_PORT = 3110;
const HUB_SPECS = /hub-.*\.spec\.ts/;

// Next rewrites the tsconfig it is given to include its distDir, so each fixture
// server gets a throwaway tsconfig in .next instead of dirtying the real one.
function fixtureTsconfig(f: Fixture | "hub"): string {
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
  timeout: 120_000,
  env: {
    // The github server shows the full board plus fixture GitHub data.
    NOW_FIXTURE: f === "github" ? "full.json" : `${f}.json`,
    GITHUB_TOKEN: "",
    SUPABASE_URL: "",
    ...(f === "github" ? { GITHUB_FIXTURE: "github-graphql.json" } : {}),
    NEXT_DIST_DIR: `.next/e2e-${f}`,
    NEXT_TSCONFIG: fixtureTsconfig(f),
  },
}));

// Hub specs need a real Supabase, so their server gets the local stack, never the live one.
const localSupabase = localSupabaseEnv();

const hubServer = {
  command: `npx next dev -p ${HUB_PORT}`,
  url: `http://localhost:${HUB_PORT}`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    GITHUB_TOKEN: "",
    NEXT_PUBLIC_SUPABASE_URL: localSupabase.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabase.anonKey,
    SUPABASE_URL: localSupabase.url,
    SUPABASE_SERVICE_ROLE_KEY: localSupabase.serviceKey,
    HUB_OWNER_GITHUB_ID: "77211262",
    NEXT_DIST_DIR: ".next/e2e-hub",
    NEXT_TSCONFIG: fixtureTsconfig("hub"),
  },
};

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
    {
      command: `npx next dev -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      // Never reuse: a stray server here could have the real GitHub token or Supabase keys.
      reuseExistingServer: false,
      timeout: 120_000,
      // Empty beats .env.local, so e2e never calls live GitHub or writes to the real leaderboard.
      env: { GITHUB_TOKEN: "", SUPABASE_URL: "" },
    },
    ...fixtureServers,
    hubServer,
  ],
});
