import { achievements, contact, role, siteUrl } from "@/content/site";
import { bookingUrl, coffee, coffeeUpdated } from "@/content/coffee";
import { LETTERBOXD_PROFILE } from "@/lib/letterboxd";
import { sitePhotos } from "@/lib/seo/site-images";

// "AI around the world" keeps its capitals; "Tech" becomes "tech".
const midSentence = (label: string) => (/^[A-Z]{2}/.test(label) ? label : label[0].toLowerCase() + label.slice(1));

export const PERSON_ID = `${siteUrl}/#person`;
const COFFEE_URL = `${siteUrl}/coffee`;

// The one Person; other pages point at it by @id so its facts can't drift.
const person = {
  "@type": "Person",
  "@id": PERSON_ID,
  name: "Mason Bair",
  jobTitle: role.title,
  description:
    `${role.title} at ${role.employerFull} and digital nomad. Background in DevSecOps, system administration, and software development. Kent State computer science graduate, May 2026.`,
  // Several photos, profile first, so image search can tie each one to him.
  image: sitePhotos().map((p) => ({ "@type": "ImageObject", contentUrl: p.url, caption: p.alt })),
  url: siteUrl,
  sameAs: [contact.github, contact.linkedin, LETTERBOXD_PROFILE],
  worksFor: { "@type": "Organization", name: role.employerFull },
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
      description: `A 30 minute video call with anyone who has something interesting to share. Topics often include ${coffee.topics.map((t) => midSentence(t.label)).join(", ")}.`,
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

/** Anchor id for a project on /projects, e.g. "NexHacks, 1st and 2nd place" becomes "nexhacks-1st-and-2nd-place". */
export function projectSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function projectsJsonLd() {
  const url = `${siteUrl}/projects`;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    url,
    name: "Mason Bair's projects and hackathon wins",
    about: { "@id": PERSON_ID },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: achievements.map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "CreativeWork",
          name: a.title,
          description: a.summary,
          url: a.href ?? `${url}#${projectSlug(a.title)}`,
          ...(a.image && { image: `${siteUrl}${a.image.src}` }),
          ...(a.tech.length && { keywords: a.tech.join(", ") }),
          creator: { "@id": PERSON_ID },
        },
      })),
    },
  };
}

/** JSON for a ld+json script; `<` is escaped so no string can close the tag (Next.js JSON-LD guide). */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
