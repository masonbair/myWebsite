import { describe, expect, it } from "vitest";
import { clientIp, createLeaderboardHandlers, hashIp, type LeaderboardStore } from "@/lib/leaderboard-server";

type Row = { name: string; score: number; ip_hash: string; created_at: number };

function fakeStore(rows: Row[] = []) {
  let clock = Date.parse("2026-11-04T12:00:00Z");
  const store: LeaderboardStore = {
    async top(limit) {
      return [...rows]
        .sort((a, b) => b.score - a.score || a.created_at - b.created_at)
        .slice(0, limit)
        .map(({ name, score }) => ({ name, score }));
    },
    async countSince(ipHash, since) {
      return rows.filter((r) => r.ip_hash === ipHash && r.created_at >= since.getTime()).length;
    },
    async insert(row) {
      rows.push({ ...row, created_at: clock });
    },
  };
  return {
    store,
    rows,
    now: () => new Date(clock),
    advance: (minutes: number) => void (clock += minutes * 60_000),
  };
}

const post = (body: unknown, ip = "1.2.3.4") =>
  new Request("http://localhost/api/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function setup(rows?: Row[]) {
  const fake = fakeStore(rows);
  const handlers = createLeaderboardHandlers({ store: fake.store, salt: "test-salt", now: fake.now });
  return { ...fake, ...handlers };
}

describe("POST /api/leaderboard", () => {
  it("saves a valid score and returns the new top list", async () => {
    const { POST, rows } = setup();
    const res = await POST(post({ name: "  Mason   B ", score: 12 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ entries: [{ name: "Mason B", score: 12 }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].ip_hash).toBe(hashIp("1.2.3.4", "test-salt"));
  });

  it("gives 429 on the sixth post from one IP within 10 minutes", async () => {
    const { POST, rows, advance } = setup();
    for (let i = 0; i < 5; i++) {
      expect((await POST(post({ name: "a", score: i + 1 }))).status).toBe(201);
      advance(1);
    }
    const res = await POST(post({ name: "a", score: 9 }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(rows).toHaveLength(5);
    expect((await POST(post({ name: "b", score: 9 }, "5.6.7.8"))).status).toBe(201);
  });

  it("allows posts again once the window passes", async () => {
    const { POST, advance } = setup();
    for (let i = 0; i < 5; i++) await POST(post({ name: "a", score: 1 }));
    advance(10.01);
    expect((await POST(post({ name: "a", score: 1 }))).status).toBe(201);
  });

  it("rejects a huge score with 400 and inserts nothing", async () => {
    const { POST, rows } = setup();
    const res = await POST(post({ name: "cheater", score: 10_000_000 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_score" });
    expect(rows).toHaveLength(0);
  });

  it("rejects an offensive name with 400", async () => {
    const { POST, rows } = setup();
    const res = await POST(post({ name: "fuck", score: 3 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "offensive_name" });
    expect(rows).toHaveLength(0);
  });

  it("rejects bad JSON and oversized bodies with 400", async () => {
    const { POST, rows } = setup();
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post({ name: "a", score: 1, pad: "x".repeat(5000) }))).status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("hashes a constant when there is no forwarded IP", async () => {
    const { POST, rows } = setup();
    const req = new Request("http://localhost/api/leaderboard", {
      method: "POST",
      body: JSON.stringify({ name: "a", score: 1 }),
    });
    expect((await POST(req)).status).toBe(201);
    expect(rows[0].ip_hash).toBe(hashIp("unknown", "test-salt"));
  });
});

describe("GET /api/leaderboard", () => {
  it("returns at most 10 entries, best first, earliest first on ties", async () => {
    const rows: Row[] = Array.from({ length: 14 }, (_, i) => ({
      name: `p${i}`,
      score: (i % 7) + 1,
      ip_hash: "h",
      created_at: i,
    }));
    const { GET } = setup(rows);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { entries } = await res.json();
    expect(entries).toHaveLength(10);
    expect(entries.map((e: { score: number }) => e.score)).toEqual([7, 7, 6, 6, 5, 5, 4, 4, 3, 3]);
    expect(entries[0]).toEqual({ name: "p6", score: 7 });
  });
});

describe("unavailable", () => {
  it("returns 503 when the store or salt is missing", async () => {
    for (const deps of [{ store: null, salt: "s" }, { store: fakeStore().store, salt: "" }]) {
      const { GET, POST } = createLeaderboardHandlers(deps);
      expect((await GET()).status).toBe(503);
      const res = await POST(post({ name: "a", score: 1 }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "unavailable" });
    }
  });

  it("returns 500 when the store throws", async () => {
    const broken: LeaderboardStore = {
      top: () => Promise.reject(new Error("db down")),
      countSince: () => Promise.reject(new Error("db down")),
      insert: () => Promise.reject(new Error("db down")),
    };
    const { GET, POST } = createLeaderboardHandlers({ store: broken, salt: "s" });
    expect((await GET()).status).toBe(500);
    expect((await POST(post({ name: "a", score: 1 }))).status).toBe(500);
  });
});

describe("clientIp", () => {
  const ip = (xff: string) => clientIp(new Request("http://x", { headers: { "x-forwarded-for": xff } }));

  it("uses the first forwarded IPv4 as is", () => {
    expect(ip(" 1.2.3.4 , 10.0.0.1")).toBe("1.2.3.4");
    expect(ip("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("groups IPv6 by its /64 so one visitor can't rotate addresses past the limit", () => {
    expect(ip("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(ip("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(ip("2001:db8::5")).toBe("2001:db8:0:0::/64");
  });
});
