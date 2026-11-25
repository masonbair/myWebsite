import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getRecentFilms, parseLetterboxdFeed, stars } from "@/lib/letterboxd";

const feed = readFileSync("tests/e2e/fixtures/letterboxd.xml", "utf8");

const item = (inner: string) => `<rss><channel><item>${inner}</item></channel></rss>`;
const entry = (extra = "") =>
  item(`<link>https://letterboxd.com/masonbair/film/x/</link><guid isPermaLink="false">letterboxd-watch-1</guid>
    <letterboxd:watchedDate>2026-11-01</letterboxd:watchedDate><letterboxd:filmTitle>Tom &amp; Jerry</letterboxd:filmTitle>${extra}`);

describe("parseLetterboxdFeed", () => {
  it("reads Mason's real feed into films, newest first, with reviews", () => {
    const films = parseLetterboxdFeed(feed);
    expect(films).toHaveLength(5);
    expect(films[0]).toMatchObject({
      title: "The Hunger Games: Sunrise on the Reaping",
      year: "2026",
      watchedOn: "2026-11-23",
      rating: 3,
      liked: false,
      rewatch: false,
      url: "https://letterboxd.com/masonbair/film/the-hunger-games-sunrise-on-the-reaping/",
    });
    expect(films[0].poster).toMatch(/^https:\/\/a\.ltrbxd\.com\/resized\/film-poster\/.+\.jpg$/);
    expect(films[0].review).toMatch(/^The story and feels of this movie were great!/);
    expect(films.map((f) => f.watchedOn)).toEqual([...films.map((f) => f.watchedOn)].sort().reverse());
  });

  it("decodes entities and leaves out rating, poster and review when the entry has none", () => {
    expect(parseLetterboxdFeed(entry())).toEqual([
      { title: "Tom & Jerry", year: null, watchedOn: "2026-11-01", rating: null, liked: false, rewatch: false, url: "https://letterboxd.com/masonbair/film/x/", poster: null, review: null },
    ]);
  });

  it("drops links off Mason's profile and posters from other hosts", () => {
    const offsite = item(`<link>https://evil.test/masonbair/</link><letterboxd:watchedDate>2026-11-01</letterboxd:watchedDate><letterboxd:filmTitle>X</letterboxd:filmTitle>`);
    expect(parseLetterboxdFeed(offsite)).toEqual([]);
    const poster = entry(`<description><![CDATA[<p><img src="https://evil.test/resized/film-poster/a.jpg"/></p>]]></description>`);
    expect(parseLetterboxdFeed(poster)[0].poster).toBeNull();
  });

  it("skips items that are not diary entries, like lists", () => {
    expect(parseLetterboxdFeed(item(`<title>My list</title><link>https://letterboxd.com/masonbair/list/a/</link>`))).toEqual([]);
  });
});

describe("stars", () => {
  it("draws whole and half stars", () => {
    expect(stars(3)).toBe("★★★");
    expect(stars(3.5)).toBe("★★★½");
    expect(stars(0.5)).toBe("½");
  });
});

describe("getRecentFilms", () => {
  it("returns an empty list when the feed fails", async () => {
    expect(await getRecentFilms(4, async () => new Response("", { status: 503 }))).toEqual([]);
    expect(await getRecentFilms(4, () => Promise.reject(new Error("down")))).toEqual([]);
  });

  it("caps the list", async () => {
    expect(await getRecentFilms(2, async () => new Response(feed))).toHaveLength(2);
  });
});
