import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { bookingMailto, bookingUrl, coffee, coffeeUpdated } from "@/content/coffee";
import { contact } from "@/content/site";
import { coffeeJsonLd } from "@/lib/jsonld";
import { INDEXNOW_KEY, indexNowPayload } from "@/scripts/indexnow";

const ld = coffeeJsonLd();

describe("coffee json-ld", () => {
  it("has a dateModified matching the visible last updated date", () => {
    expect(ld.dateModified).toBe(new Date(coffeeUpdated).toISOString());
  });

  it("books through an EntryPoint on the real booking URL", () => {
    const action = ld.potentialAction;
    expect(action["@type"]).toBe("ScheduleAction");
    expect(action.target["@type"]).toBe("EntryPoint");
    expect(action.target.urlTemplate).toBe(bookingUrl);
  });

  it("lists every niche section by its anchor", () => {
    expect(ld.hasPart.map((part) => part.url)).toEqual(
      coffee.niches.map((niche) => `https://masonbair.com/coffee#${niche.id}`),
    );
    expect(coffee.niches.map((n) => n.id)).toEqual(["devsecops", "nomad", "kent-state"]);
  });

  it("never claims the chat is free until Mason confirms it", () => {
    expect(JSON.stringify([ld, coffee]).toLowerCase()).not.toMatch(/\bfree\b/);
  });
});

describe("email booking fallback", () => {
  it("is a prefilled mailto to the public contact email", () => {
    const url = new URL(bookingMailto);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(contact.email);
    expect(url.searchParams.get("subject")).toBe("Coffee chat request");
    expect(url.searchParams.get("body")).toContain("Three times that work for me");
  });
});

describe("sitemap", () => {
  it("lists home and coffee, with coffee dated by its own update", () => {
    const entries = sitemap();
    expect(entries.map((e) => e.url)).toEqual(["https://masonbair.com", "https://masonbair.com/coffee"]);
    expect(entries[1].lastModified).toEqual(new Date(coffeeUpdated));
  });
});

describe("llms.txt", () => {
  it("matches the page's booking URL, email, and niche anchors", () => {
    const text = readFileSync("public/llms.txt", "utf8");
    expect(text).toContain(bookingUrl);
    expect(text).toContain(contact.email);
    for (const { id } of coffee.niches) expect(text).toContain(`https://masonbair.com/coffee#${id}`);
  });
});

describe("indexnow", () => {
  it("serves the key file at the site root", () => {
    expect(readFileSync(`public/${INDEXNOW_KEY}.txt`, "utf8").trim()).toBe(INDEXNOW_KEY);
  });

  it("builds a payload from same-host sitemap URLs only", () => {
    const xml = "<urlset><url><loc>https://masonbair.com</loc></url><url><loc>https://masonbair.com/coffee</loc></url><url><loc>https://evil.example/x</loc></url></urlset>";
    expect(indexNowPayload("https://masonbair.com", xml)).toEqual({
      host: "masonbair.com",
      key: INDEXNOW_KEY,
      keyLocation: `https://masonbair.com/${INDEXNOW_KEY}.txt`,
      urlList: ["https://masonbair.com", "https://masonbair.com/coffee"],
    });
  });

  it("ignores a trailing slash on the site URL", () => {
    expect(indexNowPayload("https://masonbair.com/", "").keyLocation).toBe(`https://masonbair.com/${INDEXNOW_KEY}.txt`);
  });
});
