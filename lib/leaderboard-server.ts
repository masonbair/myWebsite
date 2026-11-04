import "server-only";
import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";
import { MAX_NAME, MAX_SCORE, RATE_LIMIT, type Entry } from "./leaderboard";

export type EntryError = "bad_name" | "offensive_name" | "bad_score";

const TOP = 10;
const MAX_BODY = 1024;
// Control and format characters (tabs, zero-width, right-to-left overrides) can disguise a name.
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/u;

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/** Checks and tidies a posted score; extra fields are dropped. */
export function validateEntry(raw: unknown): { ok: true; entry: Entry } | { ok: false; error: EntryError } {
  const { name, score } = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof name !== "string" || HIDDEN_CHARS.test(name)) return { ok: false, error: "bad_name" };
  const clean = name.trim().replace(/\s+/g, " ");
  // Count code points, like Postgres char_length, not UTF-16 units.
  const length = [...clean].length;
  if (length < 1 || length > MAX_NAME) return { ok: false, error: "bad_name" };
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > MAX_SCORE) {
    return { ok: false, error: "bad_score" };
  }
  if (matcher.hasMatch(clean)) return { ok: false, error: "offensive_name" };
  return { ok: true, entry: { name: clean, score } };
}

/** Salted sha256 hex of an IP, so raw IPs are never stored. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

// One home or phone usually owns a whole IPv6 /64, so rate limiting single addresses is easy to dodge.
function ipv6Prefix(ip: string): string {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

/** Rate limit key: the first `x-forwarded-for` entry (Vercel sets it), IPv6 grouped by /64, or "unknown". */
export function clientIp(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return isIPv6(ip) ? ipv6Prefix(ip) : ip;
}

export type LeaderboardStore = {
  top(limit: number): Promise<Entry[]>;
  countSince(ipHash: string, since: Date): Promise<number>;
  insert(row: Entry & { ip_hash: string }): Promise<void>;
};

type Deps = { store: LeaderboardStore | null; salt: string | undefined; now?: () => Date };

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function readBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** GET and POST handlers over any store; route.ts passes the Supabase one. */
export function createLeaderboardHandlers({ store, salt, now = () => new Date() }: Deps) {
  return {
    async GET(): Promise<Response> {
      if (!store || !salt) return json({ error: "unavailable" }, 503);
      try {
        return json({ entries: await store.top(TOP) });
      } catch (err) {
        console.error("leaderboard GET failed", err);
        return json({ error: "server_error" }, 500);
      }
    },

    async POST(req: Request): Promise<Response> {
      if (!store || !salt) return json({ error: "unavailable" }, 503);
      const result = validateEntry(await readBody(req));
      if (!result.ok) return json({ error: result.error }, 400);
      const ipHash = hashIp(clientIp(req), salt);
      try {
        // Check then insert is not atomic, so a burst can slip a few extra rows past the limit; fine at this scale.
        const since = new Date(now().getTime() - RATE_LIMIT.windowMinutes * 60_000);
        if ((await store.countSince(ipHash, since)) >= RATE_LIMIT.max) return json({ error: "rate_limited" }, 429);
        await store.insert({ ...result.entry, ip_hash: ipHash });
        return json({ entries: await store.top(TOP) }, 201);
      } catch (err) {
        console.error("leaderboard POST failed", err);
        return json({ error: "server_error" }, 500);
      }
    },
  };
}

/** Supabase-backed store from env, or null when env is missing. Uses the service role key: server only. */
export function supabaseStore(): LeaderboardStore | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async top(limit) {
      const { data, error } = await db
        .from("leaderboard")
        .select("name, score")
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data;
    },
    async countSince(ipHash, since) {
      const { count, error } = await db
        .from("leaderboard")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", since.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    async insert(row) {
      const { error } = await db.from("leaderboard").insert(row);
      if (error) throw error;
    },
  };
}
