import { describe, expect, it } from "vitest";
import { PHONE } from "../e2e/phone";
import { coffeeJsonLd, homeJsonLd, PERSON_ID, serializeJsonLd, websiteJsonLd } from "@/lib/jsonld";

const home = homeJsonLd(new Date("2026-11-04T00:00:00Z"));
const coffee = coffeeJsonLd();

describe("json-ld", () => {
  it("home is a ProfilePage about the Person", () => {
    expect(home["@context"]).toBe("https://schema.org");
    expect(home["@type"]).toBe("ProfilePage");
    expect(home.dateModified).toBe("2026-11-04T00:00:00.000Z");
    const person = home.mainEntity;
    expect(person["@type"]).toBe("Person");
    expect(person["@id"]).toBe("https://masonbair.com/#person");
    expect(person.url).toBe("https://masonbair.com");
    expect(person.image).toBe("https://masonbair.com/misc/Mason_web.webp");
    expect(person.sameAs).toEqual(
      expect.arrayContaining(["https://github.com/masonbair", "https://www.linkedin.com/in/masonbair/"]),
    );
    expect(person.knowsAbout.length).toBeGreaterThan(2);
  });

  it("names the site Mason Bair and credits the same Person", () => {
    const site = websiteJsonLd();
    expect(site["@type"]).toBe("WebSite");
    expect(site.name).toBe("Mason Bair");
    expect(site.url).toBe("https://masonbair.com");
    expect(site.publisher).toEqual({ "@id": PERSON_ID });
  });

  it("lists his current interests", () => {
    expect(home.mainEntity.knowsAbout).toEqual(expect.arrayContaining(["Forward deployed engineering", "Artificial intelligence"]));
  });

  it("home offers a coffee chat ScheduleAction", () => {
    const action = home.mainEntity.potentialAction;
    expect(action["@type"]).toBe("ScheduleAction");
    expect(action.name).toBe("Book a coffee chat");
    expect(action.target).toBe("https://masonbair.com/coffee");
  });

  it("coffee points at the same Person without redefining it", () => {
    expect(coffee["@context"]).toBe("https://schema.org");
    expect(coffee["@type"]).toBe("WebPage");
    expect(coffee.url).toBe("https://masonbair.com/coffee");
    expect(coffee.about).toEqual({ "@id": PERSON_ID });
  });

  it("never holds a phone, address, or coordinates", () => {
    const text = JSON.stringify([home, coffee, websiteJsonLd()]);
    for (const banned of ["telephone", "address", "geo", "latitude", "FAQPage", "—", "–"]) {
      expect(text).not.toContain(banned);
    }
    expect(text).not.toMatch(PHONE);
  });

  it("escapes < so a string cannot close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});
