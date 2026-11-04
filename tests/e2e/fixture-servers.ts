export const FIXTURES = ["full", "empty", "private", "coords", "github"] as const;
export type Fixture = (typeof FIXTURES)[number];

export const fixturePort = (f: Fixture) => 3101 + FIXTURES.indexOf(f);
export const fixtureUrl = (f: Fixture) => `http://localhost:${fixturePort(f)}/`;
