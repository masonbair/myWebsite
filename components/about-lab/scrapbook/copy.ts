// Draft copy for the scrapbook About, kept here so Mason can compare it with `about` in content/site.ts.
// Every fact comes from content/site.ts; the countries count is read live from lib/now.ts.

export type StickerFill = "surface" | "tea" | "rose" | "accent";

export type FactSticker = {
  id: string;
  fill: StickerFill;
  /** Small line above the title, e.g. where or when. */
  kicker: string;
  title: string;
  /** The longer story on the back; a sticker without one does not flip. */
  story?: string;
};

export const hello = {
  prompt: "cat about.txt",
  tag: "About me",
  heading: "Good day beautiful people.",
  body: "I'm Mason. I'm 22, a forward deployed engineer at Fullsend, and a digital nomad working from wherever I'm at. Each day is a new day, so I like to say yolo.",
  hint: "Tap a sticker to flip it.",
};

export const countries = {
  kicker: "Slow traveler",
  favoritesLabel: "Favorites",
  favorites: ["Estonia", "Japan", "Guatemala"],
  story:
    "All over North America, Europe and Asia so far. I'm a slow traveler, so I take my time to explore every city I visit.",
};

export const facts: FactSticker[] = [
  {
    id: "fullsend",
    fill: "surface",
    kicker: "Day job",
    title: "Forward deployed engineer at Fullsend",
    story: "My first full-time job after graduating. It's fully remote, so I build software from wherever I'm traveling.",
  },
  {
    id: "hacksu",
    fill: "accent",
    kicker: "Kent State's CS club",
    title: "HacKSU president",
    story:
      "I led 11 other organizers, hosted weekly meetings and ran Kent Hack Enough. One of the connections I made there pointed me to the job I have now. Without that work, I would not be where I am today.",
  },
  {
    id: "estonia",
    fill: "surface",
    kicker: "Tartu University, 2024 to 2025",
    title: "A full school year in Estonia",
    story:
      "My classmates came from all over the world, and I built friendships there that will last a lifetime. I still miss it. I earned over $12,000 in scholarships for tuition and paid for my room and food with my school job.",
  },
  {
    id: "honey",
    fill: "tea",
    kicker: "When I'm home",
    title: "I bake with honey, never white sugar",
    story:
      "Mostly banana bread and pumpkin bread, sometimes pumpkin pie, brownies or cookies. Baking's on hold while I travel though.",
  },
  {
    id: "hostel",
    fill: "surface",
    kicker: "Puerto Escondido, 1.5 months",
    title: "Hostel social host",
    story: "I volunteered at a Viajero hostel and led all the evening socials: karaoke, trivia and bar games.",
  },
  {
    id: "school-jobs",
    fill: "surface",
    kicker: "Jobs during school",
    title: "Servers, security and outreach",
    story:
      "I set up GPU servers for research and used Ansible to keep 20+ servers in line with security rules. I was the CS department's industry outreach intern. Before that, I interned in DevSecOps at Nationwide.",
  },
  { id: "award", fill: "rose", kicker: "Kent State, April 2026", title: "Distinguished Student Leadership Award" },
  { id: "eagle", fill: "surface", kicker: "Scouts BSA, 2016 to 2022", title: "Eagle Scout" },
];
