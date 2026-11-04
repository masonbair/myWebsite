import { afterEach, describe, expect, it, vi } from "vitest";
import { getBoard } from "@/lib/board";
import { parseNow, readNow } from "@/lib/now";
import type { GithubActivity } from "@/lib/github";

const now = parseNow({ countriesVisited: 23 });
const github: GithubActivity = { commits30d: 4, private30d: 0, total30d: 4, repos30d: 2, recent: [], online: [] };

describe("getBoard", () => {
  it("getBoard merges sources", async () => {
    const board = await getBoard({ readNow: async () => now, github: async () => github });
    expect(board).toEqual({ now, github });
  });

  it("getBoard survives github throwing", async () => {
    const board = await getBoard({
      readNow: async () => now,
      github: () => {
        throw new Error("rate limited");
      },
    });
    expect(board).toEqual({ now, github: null });
  });

  it("getBoard survives the now source throwing", async () => {
    const board = await getBoard({ readNow: async () => Promise.reject(new Error("down")), github: async () => github });
    expect(board.now).toEqual(parseNow(null));
    expect(board.github).toEqual(github);
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
