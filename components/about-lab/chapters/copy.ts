import now from "@/content/now.json";
import { role, work, type SiteImage } from "@/content/site";
import type { ChapterPin } from "./photos";

/** Shown when a chapter has no photo, or its pinned album photo is hidden. */
export type StickerKind = "hacksu" | "estonia" | "fullsend" | "nomad" | "bake";

export type Chapter = {
  id: string;
  /** Short name for the contents list and the chapter's kicker. */
  label: string;
  when: string;
  title: string;
  body: string[];
  tags?: { heading: string; items: string[] };
  media: { image: SiteImage } | { pin: ChapterPin; sticker: StickerKind } | { sticker: StickerKind };
};

const hacksuPhoto = work.find((w) => w.org === "HacKSU")?.image;

// Draft copy for the lab; Mason's current text is `about` in content/site.ts.
export const intro =
  "Good day beautiful people! I'm Mason, I'm 22, and I like to say yolo. Here's how I got here, in five short chapters.";

export const chapters: Chapter[] = [
  {
    id: "kent-state",
    label: "Kent State",
    when: "2023 to May 2026",
    title: "I ran the biggest CS club at Kent State.",
    body: [
      "As president of HacKSU, I led 11 other organizers. We hosted weekly meetings and ran Kent Hack Enough, our hackathon.",
      "On the side I set up GPU servers for research and kept 20+ servers in line with Ansible.",
    ],
    media: hacksuPhoto ? { image: hacksuPhoto } : { sticker: "hacksu" },
  },
  {
    id: "estonia",
    label: "Estonia",
    when: "Aug 2024 to Jun 2025",
    title: "Then I spent a school year in Estonia.",
    body: [
      "I studied at Tartu University with classmates from all over the world, and I still miss it.",
      "Over $12,000 in scholarships paid my tuition, and my job paid for room and food.",
    ],
    media: { sticker: "estonia" },
  },
  {
    id: "fullsend",
    label: "Fullsend",
    when: "May 2026 to now",
    title: "The club's network found me a job.",
    body: [
      `Running HacKSU meant meeting a lot of people. One of them pointed me toward ${role.employer}, where I'm now a ${role.title}.`,
      "Without all the work I put into that connection pool, I wouldn't be where I am today.",
    ],
    media: { pin: "fullsend", sticker: "fullsend" },
  },
  {
    id: "on-the-road",
    label: "On the road",
    when: "Right now",
    title: "Now I work from wherever I'm at.",
    body: [
      `${now.countriesVisited} countries so far, and I take my time in every city.`,
      "I once volunteered 1.5 months at a Viajero hostel in Puerto Escondido, running karaoke, trivia and bar games.",
    ],
    tags: { heading: "Favorites", items: ["Estonia", "Japan", "Guatemala"] },
    media: { pin: "nomad", sticker: "nomad" },
  },
  {
    id: "off-the-clock",
    label: "Off the clock",
    when: "Whenever I'm home",
    title: "I bake with honey, not sugar.",
    body: [
      "Mostly banana bread and pumpkin bread. Baking's on hold while I travel, though.",
      "I'm also an Eagle Scout, and in April 2026 Kent State gave me the Distinguished Student Leadership Award.",
    ],
    media: { sticker: "bake" },
  },
];

export const outro = {
  title: "Next chapter: not written yet.",
  body: "If you have something interesting to share, I'd love to hear it.",
};
