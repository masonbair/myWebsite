import now from "./now.json";
import { contact } from "./site";

// Draft copy; Mason will edit. The booking URL lives only here.
export const bookingUrl = "https://calendar.app.google/suAxGdTVkbEB2GFN6";

export type TopicIcon = "shield" | "trophy" | "compass" | "plane";

export const coffee: {
  title: string;
  description: string;
  heading: string;
  bio: string[];
  format: { label: string; value: string }[];
  topicsHeading: string;
  topics: { icon: TopicIcon; label: string; detail: string }[];
  audience: string;
  timeZoneHeading: string;
  timeZoneNote: string;
  faqHeading: string;
  faqs: { q: string; a: string }[];
  linksHeading: string;
} = {
  title: "Coffee chat",
  description:
    "Book a free 30 minute video coffee chat with Mason Bair, a software engineer, about DevSecOps, hackathons, CS careers, or working while traveling.",
  heading: "Coffee chat with Mason Bair",
  bio: [
    "I'm a software engineer working across DevSecOps, system administration, and software development.",
    "I graduated from Kent State in May 2026, and now I travel and work remotely.",
  ],
  format: [
    { label: "Length", value: "30 min" },
    { label: "Where", value: "Video call" },
    { label: "Cost", value: "Free" },
  ],
  topicsHeading: "What we can talk about",
  topics: [
    { icon: "shield", label: "DevSecOps", detail: "CI/CD, security checks, and the tools I built at Nationwide." },
    { icon: "trophy", label: "Hackathons", detail: "Running Kent Hack Enough, and how my teams placed at NexHacks." },
    { icon: "compass", label: "CS careers", detail: "Internships, first jobs, and finding your way in tech." },
    { icon: "plane", label: "Nomad life", detail: `Working remotely from the road, ${now.countriesVisited} countries in.` },
  ],
  audience: "For students, new grads, and anyone curious about tech. No agenda needed.",
  timeZoneHeading: "Time zones",
  timeZoneNote:
    "I travel, so my time zone changes. The booking page shows open times in your own time zone.",
  faqHeading: "Questions",
  faqs: [
    {
      q: "How do I book a coffee chat with Mason Bair?",
      a: "Press Book a time, pick an open slot, and you'll get a calendar invite with a video link.",
    },
    { q: "Does it cost anything?", a: "No. A coffee chat is always free." },
    { q: "How long is a coffee chat?", a: "Thirty minutes over video, so bring your own coffee." },
    {
      q: "What if none of the times work for me?",
      a: `Email me at ${contact.email} and we'll find a time that does.`,
    },
  ],
  linksHeading: "Find me elsewhere",
};
