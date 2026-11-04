import { execSync } from "node:child_process";

export type LocalSupabase = { url: string; anonKey: string; serviceKey: string };

// Keys are read at run time and never written to disk. Anything but a running local
// stack gives empty values, which beat .env.local, so e2e can never reach the live project.
export function localSupabaseEnv(): LocalSupabase {
  const empty = { url: "", anonKey: "", serviceKey: "" };
  try {
    const out = execSync("supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const vars = Object.fromEntries([...out.matchAll(/^(\w+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]));
    if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(vars.API_URL ?? "")) return empty;
    return { url: vars.API_URL, anonKey: vars.ANON_KEY ?? "", serviceKey: vars.SERVICE_ROLE_KEY ?? "" };
  } catch {
    return empty;
  }
}
