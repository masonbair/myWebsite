import now from "./now.json";
import { contact } from "./site";

// The booking URL lives only here.
export const bookingUrl = "https://calendar.app.google/suAxGdTVkbEB2GFN6";

// Bump when the coffee page copy changes; feeds the visible "Last updated" line, dateModified, and the sitemap.
export const coffeeUpdated = "2026-11-13";

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

export type TopicIcon = "handshake" | "globe" | "cpu" | "storefront" | "plane" | "sneaker";

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
  pastChatsHeading: string;
  pastChatsIntro: string;
  pastChats: Niche[];
  emailHeading: string;
  emailSteps: string[];
  emailLink: string;
  faqHeading: string;
  faqs: { q: string; a: string }[];
  linksHeading: string;
} = {
  title: "Free Coffee Chat with Mason Bair, Forward Deployed Engineer",
  description:
    "Book a free 30 minute video coffee chat with Mason Bair, a forward deployed engineer and digital nomad. He likes meeting people who have something interesting to share, whatever they do.",
  heading: "Coffee chat with Mason Bair",
  bio: [
    "I like meeting people who have something interesting to share. Doesn't matter what you do or how long you've done it.",
    "I'm a forward deployed engineer at Fullsend and I work remotely while I travel. Grab a coffee and pick a time that works for you.",
  ],
  format: [
    { label: "Length", value: "30 min" },
    { label: "Where", value: "Video call" },
    { label: "Cost", value: "Free" },
  ],
  bookLabel: "Book a time: 30 minute coffee chat with Mason Bair on Google Calendar, opens in a new tab",
  topicsHeading: "Things I like talking about",
  topics: [
    { icon: "handshake", label: "Forward deployed engineering", detail: "Building right next to the customer, and what that job is really like." },
    { icon: "globe", label: "AI around the world", detail: "How people in different countries are building with AI and using it." },
    { icon: "cpu", label: "Tech", detail: "New tools, side projects, and whatever you're excited about right now." },
    { icon: "storefront", label: "Running your own business", detail: "I want to learn more here. If you've started something, I'd love to hear how." },
    { icon: "plane", label: "Travel", detail: `Working from the road, ${now.countriesVisited} countries in.` },
    { icon: "sneaker", label: "Running and baking", detail: "Favorite routes, races, and recipes worth trying." },
  ],
  audience: "Anyone with something interesting to share. No agenda needed, a question or a story is plenty.",
  timeZoneHeading: "Time zones",
  timeZoneNote:
    "I move around a lot, so my time zone changes. The booking page shows times in yours. If none of them work, just let me know.",
  nichesHeading: "Some chats I'm hoping for",
  niches: [
    {
      id: "devsecops",
      heading: "DevSecOps coffee chat",
      body: [
        "If you're getting into DevSecOps, or you're a developer who keeps getting handed security findings, let's talk. Same if you've been doing this for years and have stories.",
        "As a DevSecOps intern at Nationwide, I built Python tools that pull SonarQube data to reprioritize issues across 1,000+ apps, and I migrated CI/CD workflows. At Kent State, I kept 20+ research servers in line with security rules using Ansible.",
        "We can swap notes on which security checks are worth adding to a pipeline, or how to get developers to actually fix what the scanners find.",
      ],
    },
    {
      id: "nomad",
      heading: "Digital nomad engineer",
      body: [
        `I'm a digital nomad. I work remotely while I travel, and I've been to ${now.countriesVisited} countries so far. Before that I spent a full school year studying CS at Tartu University in Estonia.`,
        "Ask me about working across time zones or staying reliable on the road. If you've done this too, I'd love to hear your tips.",
      ],
    },
    {
      id: "kent-state",
      heading: "Kent State CS students and alumni",
      body: [
        "I graduated from Kent State in May 2026 with a B.S. in Computer Science. I was President of HacKSU, the biggest CS club on campus, and I did industry outreach for the university.",
        "I also worked at the IT help desk and as an assistant sysadmin on campus, and did undergrad research on a web version of ImageJ.",
        "Happy to talk about anything Kent State, especially study abroad or running a hackathon.",
      ],
    },
  ],
  pastChatsHeading: "Past chats",
  pastChatsIntro: "A couple of recent ones, shared without names.",
  pastChats: [
    {
      id: "past-hostel-friend",
      heading: "Reconnecting with a friend from a hostel",
      body: [
        "We met at a hostel in Brussels in 2025 and hadn't talked in a year and a half. She found this page and booked a time.",
        "She works with data for a city government in Europe and builds AI tools for kindergartens, like a story phone that helps kids practice the local language. I told her about testing nomad life in Europe while working US hours.",
        "What I took away: some of the most useful AI work I hear about isn't in big tech. It's people inside public services fixing real problems.",
      ],
    },
    {
      id: "past-estonia-classmate",
      heading: "Catching up with a classmate from Estonia",
      body: [
        "We studied together in Tartu. I saw her new job on LinkedIn and reached out.",
        "She just started at a software consultancy that works for a big bank, where AI tools are blocked on her work laptops. My days run on AI tools, so we compared how differently companies are taking it on.",
        "What I took away: AI at work looks very different from one country and company to the next. And the people you meet abroad are worth keeping in touch with.",
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
      a: `Press Book a time, pick an open slot, and you'll get a calendar invite with a video link. If the booking page doesn't work for you, just email ${contact.email}.`,
    },
    { q: "Is it free?", a: "Yes. Coffee chats are always free." },
    { q: "How long is a coffee chat?", a: "Thirty minutes over video. Bring your own coffee." },
    {
      q: "Who is it for?",
      a: "Anyone with something interesting to share. You don't need to work in tech.",
    },
    {
      q: "What time zone are you in?",
      a: "It changes as I travel. The booking page shows open times in your time zone, so you don't have to do the math.",
    },
    { q: "Do I need to prepare anything?", a: "Nope. Bring a question or a story if you have one." },
    {
      q: "What if none of the times work for me?",
      a: `Email me at ${contact.email} with a few times that work for you and we'll figure it out.`,
    },
  ],
  linksHeading: "Find me elsewhere",
};
