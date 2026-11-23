import { formatLocation } from "@/lib/location";
import type { Bake, Place } from "@/lib/now";
import { role } from "@/content/site";

export type Fill = "tea" | "accent" | "rose" | "surface";

/** One question chip and its answer sticker; `photo` is an album asset id (the number in /photos/<id>). */
export type Answer = {
  id: string;
  question: string;
  command: string;
  fill: Fill;
  big?: string;
  body: string;
  tags: string[];
  photo?: string;
};

/** The answer shown before a visitor picks anything. */
export const DEFAULT_ANSWER = "whoami";

type Now = { place: Place | null; countriesVisited: number; bake: Bake | null };

// Draft copy, rewritten short from the `about` paragraphs in content/site.ts so Mason can compare the two.
export function buildAnswers({ place, countriesVisited, bake }: Now): Answer[] {
  const countries = countriesVisited > 0 ? `${countriesVisited} countries` : null;
  return [
    {
      id: DEFAULT_ANSWER,
      question: "Who are you?",
      command: "whoami",
      fill: "tea",
      big: "Good day beautiful people!",
      body: `My name is Mason. I am 22, a ${role.title} at ${role.employerFull}, and a digital nomad. Each day is a new day, yolo!`,
      tags: ["22 years old", "Digital nomad", "Eagle Scout"],
      photo: "26832",
    },
    {
      id: "where",
      question: "Where are you now?",
      command: "whereami",
      fill: "accent",
      big: place ? formatLocation(place) : "Somewhere new",
      body: `I work from wherever I am at. I am a slow traveller, so I take my time in every city I visit.${countries ? ` ${countries} so far, all over North America, Europe and Asia.` : ""} My top 3 favorite countries are Estonia, Guatemala and Japan.`,
      tags: countries ? [countries, "Slow traveller"] : ["Slow traveller"],
      photo: "26826",
    },
    {
      id: "job",
      question: "How did you get your job?",
      command: "git log --job",
      fill: "surface",
      big: "Through HacKSU.",
      body: "As president I led 11 other organizers, ran weekly meetings and put on Kent Hack Enough. All those connections paid off: one of them pointed me to Fullsend. Without that work, I would not be where I am today.",
      tags: ["HacKSU president", "Leadership award, April 2026"],
      photo: "26836",
    },
    {
      id: "estonia",
      question: "Why Estonia?",
      command: "cat tartu.txt",
      fill: "rose",
      big: "A full school year at Tartu University.",
      body: "August 2024 to June 2025. My classmates came from all over the world, and I made friends there for life. I still miss it. Scholarships paid the tuition and my job paid for room and food.",
      tags: ["$12,000+ in scholarships", "2 semesters"],
    },
    {
      id: "fun",
      question: "What do you do for fun?",
      command: "ls ~/fun",
      fill: "tea",
      big: "I bake a lot.",
      body: "Mostly banana bread and pumpkin bread, sweetened with honey. It is on hold while I travel. I also spent 1.5 months at a Viajero hostel in Puerto Escondido running the evening socials: karaoke, trivia and bar games.",
      tags: bake ? [`Latest bake: ${bake.name}`, "Hostel socials"] : ["Banana bread", "Hostel socials"],
      photo: "26823",
    },
    {
      id: "favorites",
      question: "Favorite countries?",
      command: "sort --fav countries",
      fill: "accent",
      big: "Estonia, Japan and Guatemala.",
      body: countries ? `Out of ${countries} so far. Ask me about any of them.` : "Ask me about any of them.",
      tags: ["Estonia", "Japan", "Guatemala"],
      photo: "26816",
    },
    {
      id: "school",
      question: "What did you do in school?",
      command: "git log --school",
      fill: "surface",
      big: "Clubs, servers, outreach and security.",
      body: "I was president of HacKSU, Kent State's biggest CS club, and we ran the Kent Hack Enough hackathon. I was also an assistant sysadmin: I set up GPU servers for research and used Ansible to keep 20+ servers in line. I was the CS department's industry outreach intern too. Before that I interned in DevSecOps at Nationwide.",
      tags: ["HacKSU", "Ansible", "GPU servers", "Nationwide"],
    },
  ];
}
