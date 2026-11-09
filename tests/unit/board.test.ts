import { afterEach, describe, expect, it, vi } from "vitest";
import { getBoard, lowerSpans } from "@/lib/board";
import { parseNow, readNow } from "@/lib/now";
import type { GithubActivity } from "@/lib/github";
import type { PublicTrends } from "@/lib/news/public";

const now = parseNow({ countriesVisited: 23 });
const github: GithubActivity = { commits30d: 4, private30d: 0, total30d: 4, repos30d: 2, recent: [], online: [] };
const trends: PublicTrends = { today: "2026-11-09", rows: [] };
const noTrends = async () => null;

describe("getBoard", () => {
  it("getBoard merges sources", async () => {
    const board = await getBoard({ readNow: async () => now, github: async () => github, trends: async () => trends });
    expect(board).toEqual({ now, github, trends });
  });

  it("getBoard survives github throwing", async () => {
    const board = await getBoard({
      readNow: async () => now,
      github: () => {
        throw new Error("rate limited");
      },
      trends: noTrends,
    });
    expect(board).toEqual({ now, github: null, trends: null });
  });

  it("getBoard survives the now source throwing", async () => {
    const board = await getBoard({
      readNow: async () => Promise.reject(new Error("down")),
      github: async () => github,
      trends: noTrends,
    });
    expect(board.now).toEqual(parseNow(null));
    expect(board.github).toEqual(github);
  });

  it("getBoard survives the trends source throwing", async () => {
    const board = await getBoard({
      readNow: async () => now,
      github: async () => github,
      trends: () => Promise.reject(new Error("down")),
    });
    expect(board.trends).toBeNull();
  });
});

describe("readNow fixture override", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads a named fixture", async () => {
    vi.stubEnv("NOW_FIXTURE", "full.json");
    expect((await readNow()).place?.city).toBe("Lisbon");
  });

  it("ignores names that could escape the fixtures folder", async () => {
    vi.stubEnv("NOW_FIXTURE", "../../../content/now.json");
    const fromContent = await readNow();
    vi.unstubAllEnvs();
    expect(fromContent).toEqual(await readNow());
  });

  it("ignores the fixture in production", async () => {
    vi.stubEnv("NOW_FIXTURE", "full.json");
    vi.stubEnv("NODE_ENV", "production");
    expect((await readNow()).place?.city).not.toBe("Lisbon");
  });
});

describe("lowerSpans", () => {
  const cols = (span: string, bp: "md" | "lg") => Number(new RegExp(`${bp}:col-span-(\\d+)`).exec(span)?.[1]);

  // Packs spans left to right the way the grid does and reports any row left short.
  function shortRows(spans: string[], bp: "md" | "lg", width: number) {
    const rows: number[] = [0];
    for (const s of spans) {
      const n = cols(s, bp);
      if (rows[rows.length - 1] + n > width) rows.push(0);
      rows[rows.length - 1] += n;
    }
    return rows.filter((r) => r !== width);
  }

  for (const keys of [["projects"], ["news"], ["projects", "news"], ["news", "bake"], ["projects", "bake"], ["projects", "news", "bake"]]) {
    it(`fills every row for ${keys.join(" + ")}`, () => {
      const spans = [...lowerSpans(keys).values()];
      expect(spans).toHaveLength(keys.length);
      expect(shortRows(spans, "lg", 12)).toEqual([]);
      expect(shortRows(spans, "md", 6)).toEqual([]);
    });
  }
});
