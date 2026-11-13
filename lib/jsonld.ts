import { contact, siteUrl } from "@/content/site";
import { bookingUrl, coffee, coffeeUpdated } from "@/content/coffee";

export const PERSON_ID = `${siteUrl}/#person`;
const COFFEE_URL = `${siteUrl}/coffee`;

// The one Person; other pages point at it by @id so its facts can't drift.
const person = {
  "@type": "Person",
  "@id": PERSON_ID,
  name: "Mason Bair",
  jobTitle: "Software Engineer",
  description:
    "Software engineer at Fullsend Solutions and digital nomad. Background in DevSecOps, system administration, and software development. Kent State computer science graduate, May 2026.",
  image: `${siteUrl}/misc/Mason_web.webp`,
  url: siteUrl,
  sameAs: [contact.github, contact.linkedin],
  worksFor: { "@type": "Organization", name: "Fullsend Solutions" },
  alumniOf: {
    "@type": "CollegeOrUniversity",
    name: "Kent State University",
    url: "https://www.kent.edu",
    sameAs: "https://en.wikipedia.org/wiki/Kent_State_University",
  },
  award: ["Distinguished Student Leadership Award (2026)", "Choose Ohio First Scholarship in Computer Science", "Eagle Scout"],
  knowsAbout: ["Forward deployed engineering", "Artificial intelligence", "DevSecOps", "System administration", "Software development", "CI/CD", "Ansible", "Docker", "AWS", "Hackathons"],
  potentialAction: { "@type": "ScheduleAction", name: "Book a coffee chat", target: COFFEE_URL },
};

export function homeJsonLd(dateModified: Date) {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: siteUrl,
    dateModified: dateModified.toISOString(),
    mainEntity: person,
  };
}

/** The site itself, so search results can show "Mason Bair" as the site name. */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: "Mason Bair",
    alternateName: "masonbair.com",
    publisher: { "@id": PERSON_ID },
  };
}

export function coffeeJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: COFFEE_URL,
    name: coffee.heading,
    description: coffee.description,
    dateModified: new Date(coffeeUpdated).toISOString(),
    about: { "@id": PERSON_ID },
    mainEntity: {
      "@type": "Service",
      name: "Coffee chat with Mason Bair",
      serviceType: "Career coffee chat",
      description: "A free 30 minute video call with anyone who has something interesting to share. Topics often include forward deployed engineering, AI around the world, tech, running your own business, travel, running and baking.",
      provider: { "@id": PERSON_ID },
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: COFFEE_URL },
    },
    hasPart: coffee.niches.map((niche) => ({
      "@type": "WebPageElement",
      name: niche.heading,
      url: `${COFFEE_URL}#${niche.id}`,
    })),
    potentialAction: {
      "@type": "ScheduleAction",
      name: "Book a coffee chat",
      target: {
        "@type": "EntryPoint",
        urlTemplate: bookingUrl,
        actionPlatform: ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"],
      },
    },
  };
}

/** JSON for a ld+json script; `<` is escaped so no string can close the tag (Next.js JSON-LD guide). */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
