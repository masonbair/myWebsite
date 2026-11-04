import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { FIXTURES, fixturePort, type Fixture } from "./tests/e2e/fixture-servers";

const PORT = 3100;

// Next rewrites the tsconfig it is given to include its distDir, so each fixture
// server gets a throwaway tsconfig in .next instead of dirtying the real one.
function fixtureTsconfig(f: Fixture): string {
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
    NOW_FIXTURE: `${f}.json`,
    GITHUB_TOKEN: "",
    ...(f === "github" ? { GITHUB_FIXTURE: "github-graphql.json" } : {}),
    NEXT_DIST_DIR: `.next/e2e-${f}`,
    NEXT_TSCONFIG: fixtureTsconfig(f),
  },
}));

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: `npx next dev -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    ...fixtureServers,
  ],
});
