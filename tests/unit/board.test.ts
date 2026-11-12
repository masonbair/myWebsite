import { afterEach, describe, expect, it, vi } from "vitest";
import { getBoard, liveElsewhere, lowerKeys, lowerSpans, MAX_BOARD_TILES } from "@/lib/board";
import type { Repo } from "@/lib/github";
import { parseNow, readNow } from "@/lib/now";
import type { GithubActivity } from "@/lib/github";
import type { PublicTrends } from "@/lib/news/public";
import { offsetMinutesAt } from "@/lib/hub/schedule";

const now = parseNow({ countriesVisited: 23 });
const github: GithubActivity = { commits30d: 4, private30d: 0, total30d: 4, repos30d: 2, recent: [], online: [] };
const trends: PublicTrends = { today: "2026-11-09", rows: [] };
const noTrends = async () => null;
const noZone = () => Promise.reject(new Error("no zone"));
const sources = { readNow: async () => now, github: async () => github, trends: noTrends };

describe("getBoard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getBoard merges sources", async () => {
    vi.stubEnv("HUB_TIME_ZONE", "");
    const board = await getBoard({ readNow: async () => now, github: async () => github, trends: async () => trends, zone: noZone });
    expect(board).toEqual({ now, github, trends, sunOffsetMinutes: null });
  });

  it("getBoard survives github throwing", async () => {
    const board = await getBoard({
      readNow: async () => now,
      github: () => {
        throw new Error("rate limited");
      },
      trends: noTrends,
      zone: async () => "Europe/Lisbon",
    });
    expect(board).toEqual({ now, github: null, trends: null, sunOffsetMinutes: offsetMinutesAt("Europe/Lisbon", new Date()) });
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

  it("zone failure gives null offset", async () => {
    vi.stubEnv("HUB_TIME_ZONE", "");
    const board = await getBoard({ ...sources, zone: () => Promise.reject(new Error("down")) });
    expect(board.sunOffsetMinutes).toBeNull();
  });

  it("zone failure falls back to HUB_TIME_ZONE", async () => {
    vi.stubEnv("HUB_TIME_ZONE", "America/New_York");
    const board = await getBoard({ ...sources, zone: () => Promise.reject(new Error("down")) });
    expect(board.sunOffsetMinutes).toBe(offsetMinutesAt("America/New_York", new Date()));
  });

  it("board never holds a zone name", async () => {
    const board = await getBoard({ ...sources, zone: async () => "Europe/Lisbon" });
    expect(typeof board.sunOffsetMinutes).toBe("number");
    expect(JSON.stringify(board)).not.toContain("Europe/");
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

describe("lowerKeys", () => {
  const flags = [true, false];

  it(`keeps the board at ${MAX_BOARD_TILES} tiles or fewer in every combination`, () => {
    for (const firstScreen of [3, 4, 5, 6])
      for (const projects of flags)
        for (const news of flags)
          for (const bake of flags)
            expect(firstScreen + lowerKeys(firstScreen, { projects, news, bake }).length).toBeLessThanOrEqual(MAX_BOARD_TILES);
  });

  it("shows news and the terminal when there is room", () => {
    expect(lowerKeys(4, { projects: true, news: true, bake: true })).toEqual(["projects", "news", "bake", "terminal"]);
  });

  it("drops news first, then bake, when the board would pass the cap", () => {
    expect(lowerKeys(5, { projects: true, news: true, bake: true })).toEqual(["projects", "bake", "terminal"]);
    expect(lowerKeys(6, { projects: true, news: true, bake: true })).toEqual(["projects", "terminal"]);
  });

  it("leaves news out when it has fewer than three rising topics", () => {
    expect(lowerKeys(4, { projects: false, news: false, bake: true })).toEqual(["bake", "terminal"]);
  });

  it("always keeps the terminal", () => {
    expect(lowerKeys(4, { projects: false, news: false, bake: false })).toEqual(["terminal"]);
  });
});

describe("liveElsewhere", () => {
  const repo = (homepage: string | null): Repo => ({ name: homepage ?? "none", url: "", homepage, description: null, pushedAt: "" });

  it("drops a project whose live link is this site", () => {
    expect(liveElsewhere([repo("https://masonbair.com"), repo("https://www.masonbair.com/")])).toEqual([]);
  });

  it("keeps projects that live somewhere else", () => {
    expect(liveElsewhere([repo("https://justporchit.com"), repo("https://masonbair.com")]).map((r) => r.homepage)).toEqual([
      "https://justporchit.com",
    ]);
  });

  it("drops projects with no or broken links", () => {
    expect(liveElsewhere([repo(null), repo("not a url")])).toEqual([]);
  });
});
