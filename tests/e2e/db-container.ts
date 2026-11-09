import { readFileSync } from "node:fs";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

/**
 * The local Supabase database container to seed through docker: SUPABASE_DB_CONTAINER, else supabase_db_<project_id> of the stack in use.
 * @param repoRoot where supabase/config.toml lives when SUPABASE_WORKDIR is unset.
 * @param read reads config.toml; injectable for tests.
 */
export function dbContainer(env: Env, repoRoot: string, read: (path: string) => string = (p) => readFileSync(p, "utf8")): string {
  if (env.SUPABASE_DB_CONTAINER) return env.SUPABASE_DB_CONTAINER;
  const dir = env.SUPABASE_WORKDIR || repoRoot;
  let projectId: string | undefined;
  try {
    projectId = read(join(dir, "supabase", "config.toml")).match(/^project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m)?.[1];
  } catch {
    projectId = undefined;
  }
  if (projectId) return `supabase_db_${projectId}`;
  // Guessing here once seeded another worktree's stack, so a custom workdir must name its own.
  if (env.SUPABASE_WORKDIR) {
    throw new Error(`no project_id in ${join(dir, "supabase", "config.toml")}; set SUPABASE_DB_CONTAINER`);
  }
  return "supabase_db_masonbair";
}
