import { describe, expect, it } from "vitest";
import { dbContainer } from "@/tests/e2e/db-container";

const config = (id: string) => `# comment\nproject_id = "${id}"\n\n[api]\nport = 54321\n# project_id = "my-firebase-project"\n`;
const files = (byPath: Record<string, string>) => (path: string) => {
  if (!(path in byPath)) throw new Error("ENOENT");
  return byPath[path];
};

describe("dbContainer", () => {
  it("uses SUPABASE_DB_CONTAINER when set", () => {
    expect(dbContainer({ SUPABASE_DB_CONTAINER: "mine", SUPABASE_WORKDIR: "/w" }, "/repo", files({}))).toBe("mine");
  });

  it("derives the name from the workdir's project_id", () => {
    expect(dbContainer({ SUPABASE_WORKDIR: "/w" }, "/repo", files({ "/w/supabase/config.toml": config("ideas-lab") }))).toBe("supabase_db_ideas-lab");
  });

  it("throws when a workdir is set but has no readable project_id", () => {
    expect(() => dbContainer({ SUPABASE_WORKDIR: "/w" }, "/repo", files({}))).toThrow(/SUPABASE_DB_CONTAINER/);
    expect(() => dbContainer({ SUPABASE_WORKDIR: "/w" }, "/repo", files({ "/w/supabase/config.toml": "[api]\n" }))).toThrow();
  });

  it("without a workdir reads the repo's own config, as before", () => {
    expect(dbContainer({}, "/repo", files({ "/repo/supabase/config.toml": config("masonbair") }))).toBe("supabase_db_masonbair");
    expect(dbContainer({}, "/repo", files({}))).toBe("supabase_db_masonbair");
  });

  it("reads this repo's real config as masonbair", () => {
    expect(dbContainer({}, process.cwd())).toBe("supabase_db_masonbair");
  });
});
