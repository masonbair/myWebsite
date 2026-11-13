import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { bookingMailto, bookingUrl, coffee, coffeeUpdated } from "@/content/coffee";
import { contact, roleLower } from "@/content/site";
import { coffeeJsonLd } from "@/lib/jsonld";
import { llmsText } from "@/lib/llms";
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

  it("says the chat is free, as a zero-price Offer on a Service Mason provides", () => {
    expect(ld.mainEntity["@type"]).toBe("Service");
    expect(ld.mainEntity.provider).toEqual({ "@id": "https://masonbair.com/#person" });
    expect(ld.mainEntity.offers).toMatchObject({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(coffee.description).toMatch(/\bfree\b/);
    expect(coffee.format).toContainEqual({ label: "Cost", value: "Free" });
    expect(coffee.faqs.find((f) => f.q === "Is it free?")?.a).toMatch(/^Yes\./);
    expect(llmsText()).toMatch(/\bfree 30 minute\b/);
  });

  it("leaves hiring and referrals unanswered until Mason decides", () => {
    expect(JSON.stringify(coffee).toLowerCase()).not.toMatch(/\b(hiring|referral)/);
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
  it("lists home and coffee, with coffee dated by its own update, and leaves out /trends with no data", async () => {
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toEqual(["https://masonbair.com", "https://masonbair.com/coffee"]);
    expect(entries[1].lastModified).toEqual(new Date(coffeeUpdated));
  });
});

describe("llms.txt", () => {
  it("matches the page's booking URL, email, and niche anchors", () => {
    const text = llmsText();
    expect(text).toContain(bookingUrl);
    expect(text).toContain(contact.email);
    for (const { id } of coffee.niches) expect(text).toContain(`https://masonbair.com/coffee#${id}`);
  });

  it("follows the page: the job title, every coffee topic, and linked projects", () => {
    const text = llmsText();
    expect(text).toContain(`a ${roleLower} at`);
    for (const { label } of coffee.topics) expect(text).toContain(`- ${label}:`);
    expect(text).toContain("[Where Are My Friends](https://wamf.masonbair.com)");
    expect(text).not.toMatch(/[—–]/);
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
