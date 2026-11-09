import now from "./now.json";
import { contact } from "./site";

// Draft copy; Mason will edit. The booking URL lives only here.
export const bookingUrl = "https://calendar.app.google/suAxGdTVkbEB2GFN6";

// Bump when the coffee page copy changes; feeds the visible "Last updated" line, dateModified, and the sitemap.
export const coffeeUpdated = "2026-11-09";

const emailSubject = "Coffee chat request";
const emailBody = [
  "Hi Mason,",
  "",
  "I'd like to book a 30 minute coffee chat.",
  "",
  "My name:",
  "What I'd like to talk about:",
  "Three times that work for me, with my time zone:",
  "How I found your page:",
].join("\r\n");

/** Booking that needs no JavaScript: a prefilled email any mail client or text-only agent can send. */
export const bookingMailto = `mailto:${contact.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

export type TopicIcon = "shield" | "trophy" | "compass" | "plane";

export type Niche = { id: string; heading: string; body: string[] };

export const coffee: {
  title: string;
  description: string;
  heading: string;
  bio: string[];
  format: { label: string; value: string }[];
  bookLabel: string;
  topicsHeading: string;
  topics: { icon: TopicIcon; label: string; detail: string }[];
  audience: string;
  timeZoneHeading: string;
  timeZoneNote: string;
  nichesHeading: string;
  niches: Niche[];
  emailHeading: string;
  emailSteps: string[];
  emailLink: string;
  faqHeading: string;
  faqs: { q: string; a: string }[];
  linksHeading: string;
} = {
  title: "Coffee chat",
  description:
    "Book a 30 minute video coffee chat with Mason Bair, a software engineer and Kent State CS graduate, about DevSecOps, hackathons, CS careers, or working remotely while traveling.",
  heading: "Coffee chat with Mason Bair",
  bio: [
    "I'm a software engineer working across DevSecOps, system administration, and software development.",
    "I graduated from Kent State in May 2026, and now I travel and work remotely.",
  ],
  format: [
    { label: "Length", value: "30 min" },
    { label: "Where", value: "Video call" },
  ],
  bookLabel: "Book a time: 30 minute coffee chat with Mason Bair on Google Calendar, opens in a new tab",
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
  nichesHeading: "Who usually books",
  niches: [
    {
      id: "devsecops",
      heading: "DevSecOps coffee chat",
      body: [
        "If you're moving into DevSecOps, or you're a developer who keeps getting handed security findings, this chat is for you.",
        "As a DevSecOps intern at Nationwide, I built Python tools that pull SonarQube data to reprioritize issues across more than 1,000 apps, and I migrated CI/CD workflows. At Kent State, I kept 20+ research servers in line with security rules using Ansible.",
        "We can talk about getting a first DevSecOps role, which security checks are worth adding to a pipeline, or how to make security findings something developers actually fix.",
      ],
    },
    {
      id: "nomad",
      heading: "Digital nomad software engineer",
      body: [
        `I work remotely while I travel, and I've been to ${now.countriesVisited} countries so far. Before that, I spent a full school year studying computer science at Tartu University in Estonia.`,
        "Ask me about working across time zones, staying reliable on the road, and what it's really like to be a software engineer without a fixed home base.",
      ],
    },
    {
      id: "kent-state",
      heading: "Kent State CS students and alumni",
      body: [
        "I graduated from Kent State in May 2026 with a B.S. in Computer Science. I was President of HacKSU, the largest CS club on campus, and helped run the Kent Hack Enough hackathon.",
        "I also worked as an IT help desk technician and an assistant system administrator on campus, and did undergraduate research building a web version of ImageJ.",
        "Happy to talk about classes, campus jobs, study abroad, landing internships, or organizing or running a hackathon.",
      ],
    },
  ],
  emailHeading: "Book by email instead",
  emailSteps: [
    `Send an email to ${contact.email} with the subject "Coffee chat request".`,
    "Include your name, what you'd like to talk about, three times that work for you with your time zone, and how you found this page.",
    "I'll reply with a calendar invite and a video link.",
  ],
  emailLink: "Email Mason to request a coffee chat",
  faqHeading: "Questions",
  faqs: [
    {
      q: "How do I book a coffee chat with Mason Bair?",
      a: `Press Book a time, pick an open slot, and you'll get a calendar invite with a video link. If the booking page doesn't work for you, email ${contact.email} instead.`,
    },
    { q: "How long is a coffee chat?", a: "Thirty minutes over video, so bring your own coffee." },
    {
      q: "Who is it for?",
      a: "Students, new grads, career changers, and anyone curious about DevSecOps, hackathons, CS careers, or working remotely while traveling.",
    },
    {
      q: "What time zone are you in?",
      a: "It changes because I travel. The booking page converts open times to your own time zone, so you don't need to work it out.",
    },
    { q: "Do I need to prepare anything?", a: "No. Bring a question or two if you have them, but no agenda is needed." },
    {
      q: "What if none of the times work for me?",
      a: `Email me at ${contact.email} with a few times that suit you and we'll find one that works.`,
    },
  ],
  linksHeading: "Find me elsewhere",
};
