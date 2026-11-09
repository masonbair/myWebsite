import now from "./now.json";
import { contact } from "./site";

// The booking URL lives only here.
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
    "Book a free 30 minute video coffee chat with Mason Bair, a software engineer and digital nomad who wants to learn from anyone with something interesting to share, whatever their background.",
  heading: "Coffee chat with Mason Bair",
  bio: [
    "I'd love to chat with anyone and everyone who has something interesting to share. I want to learn from as many people as I can, no matter your background or experience level.",
    "I'm a software engineer at Fullsend and a digital nomad, so grab a coffee and say hey from wherever you are!",
  ],
  format: [
    { label: "Length", value: "30 min" },
    { label: "Where", value: "Video call" },
    { label: "Cost", value: "Free" },
  ],
  bookLabel: "Book a time: 30 minute coffee chat with Mason Bair on Google Calendar, opens in a new tab",
  topicsHeading: "Stuff I love talking about",
  topics: [
    { icon: "shield", label: "DevSecOps", detail: "CI/CD, security checks, and what I learned at Nationwide." },
    { icon: "trophy", label: "Hackathons", detail: "Running Kent Hack Enough, and our two wins at NexHacks." },
    { icon: "compass", label: "CS careers", detail: "Internships, first jobs, and how you found your way in." },
    { icon: "plane", label: "Nomad life", detail: `Working from the road, ${now.countriesVisited} countries in.` },
  ],
  audience: "Students, seasoned pros, career changers, folks outside tech: I'd love to meet you. No agenda needed.",
  timeZoneHeading: "Time zones",
  timeZoneNote:
    "I move around a lot, so my time zone changes. No worries though, the booking page shows times in yours. If none of them work, let me know!",
  nichesHeading: "Some chats I'd love to have",
  niches: [
    {
      id: "devsecops",
      heading: "DevSecOps coffee chat",
      body: [
        "Moving into DevSecOps? A developer who keeps getting handed security findings? Or you've done this for years and have stories? Let's talk!",
        "As a DevSecOps intern at Nationwide, I built Python tools that pull SonarQube data to reprioritize issues across 1,000+ apps, and I migrated CI/CD workflows. At Kent State, I kept 20+ research servers in line with security rules using Ansible.",
        "We can swap notes on first DevSecOps roles, which security checks are worth adding to a pipeline, or how to get developers to actually fix what the scanners find.",
      ],
    },
    {
      id: "nomad",
      heading: "Digital nomad software engineer",
      body: [
        `I'm a digital nomad: I work remotely while I travel, and I've been to ${now.countriesVisited} countries so far. Before that, I spent a full school year studying CS at Tartu University in Estonia.`,
        "Ask me about working across time zones, staying reliable on the road, and what it's really like to be a software engineer with no home base. And if you've done it too, I want your tips!",
      ],
    },
    {
      id: "kent-state",
      heading: "Kent State CS students and alumni",
      body: [
        "I graduated from Kent State in May 2026 with a B.S. in Computer Science. I was President of HacKSU, the biggest CS club on campus, did industry outreach for the university, and helped run the Kent Hack Enough hackathon.",
        "I also worked at the IT help desk and as an assistant system administrator on campus, and did undergrad research building a web version of ImageJ.",
        "Happy to talk classes, campus jobs, study abroad, internships, or running a hackathon. Fellow Golden Flashes, say hey!",
      ],
    },
  ],
  emailHeading: "Book by email instead",
  emailSteps: [
    `Send an email to ${contact.email} with the subject "Coffee chat request".`,
    "Include your name, what you'd like to talk about, three times that work for you with your time zone, and how you found this page.",
    "I'll reply with a calendar invite and a video link. Easy!",
  ],
  emailLink: "Email Mason to request a coffee chat",
  faqHeading: "Questions",
  faqs: [
    {
      q: "How do I book a coffee chat with Mason Bair?",
      a: `Press Book a time, pick an open slot, and you'll get a calendar invite with a video link. If the booking page doesn't work for you, just email ${contact.email}.`,
    },
    { q: "Is it free?", a: "Yes. Coffee chats are always free!" },
    { q: "How long is a coffee chat?", a: "Thirty minutes over video. Bring your own coffee!" },
    {
      q: "Who is it for?",
      a: "Anyone and everyone with something interesting to share. I want to learn from as many people as I can, no matter your background or experience level.",
    },
    {
      q: "What time zone are you in?",
      a: "It changes as I travel. The booking page shows open times in your time zone, so you don't have to do the math.",
    },
    { q: "Do I need to prepare anything?", a: "Nope. Bring a question or a story if you have one, but no agenda needed." },
    {
      q: "What if none of the times work for me?",
      a: `Email me at ${contact.email} with a few times that work for you and we'll figure it out!`,
    },
  ],
  linksHeading: "Find me elsewhere",
};
