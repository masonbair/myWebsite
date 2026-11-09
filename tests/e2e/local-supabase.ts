import { execSync } from "node:child_process";

export type LocalSupabase = { url: string; anonKey: string; serviceKey: string; dbUrl: string };

// Keys are read at run time and never written to disk; SUPABASE_WORKDIR points the CLI at another local stack. Anything but a running local
// stack gives empty values, which beat .env.local, so e2e can never reach the live project.
export function localSupabaseEnv(): LocalSupabase {
  const empty = { url: "", anonKey: "", serviceKey: "", dbUrl: "" };
  try {
    const out = execSync("supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const vars = Object.fromEntries([...out.matchAll(/^(\w+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]));
    const local = (v = "") => URL.canParse(v) && ["127.0.0.1", "localhost"].includes(new URL(v).hostname);
    if (!local(vars.API_URL) || !local(vars.DB_URL)) {
      console.warn("local-supabase: a Supabase stack is running but its API_URL or DB_URL is not on localhost, so hub specs will skip.");
      return empty;
    }
    return { url: vars.API_URL, anonKey: vars.ANON_KEY ?? "", serviceKey: vars.SERVICE_ROLE_KEY ?? "", dbUrl: vars.DB_URL };
  } catch {
    return empty;
  }
}
