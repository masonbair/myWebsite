import type { NextConfig } from "next";

type Redirect = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

/** Old /misc file names, each mapped to its readable "mason-bair-…" name; search engines and old links still point at these. */
export const renamedFiles: Record<string, string> = {
  "Mason_web.webp": "mason-bair.webp",
  "Mason_web2.webp": "mason-bair-portrait.webp",
  "Mason_web_portrait.webp": "mason-bair-portrait.webp",
  "Mason_dressed_nicely.webp": "mason-bair-portrait.webp",
  "Mason_profile_pic.webp": "mason-bair-profile-photo.webp",
  "Old_mason_profile_picture.webp": "mason-bair-old-profile-photo.webp",
  "Mason_at_RSM_office.webp": "mason-bair-office-front-desk.webp",
  "Mason_at_RSM_office_2.webp": "mason-bair-office.webp",
  "Mason_infront_of_hacksu_sign.webp": "mason-bair-hacksu-president.webp",
  "Mason_networking_at_hackathon.webp": "mason-bair-hackathon-networking.webp",
  "Mason_networking_at_hackathon_horizontal.webp": "mason-bair-hackathon-recruiting-banner.webp",
  "Mason_traveling.webp": "mason-bair-traveling.webp",
  "Mason_at_carnegie_mellon.webp": "mason-bair-carnegie-mellon.webp",
  "image_of_code.webp": "mason-bair-coding-desk.webp",
  "Mason_with_nexhacks_team.webp": "mason-bair-nexhacks-team.webp",
  "Mason_coding_at_hackathon.webp": "mason-bair-coding-at-hackathon.webp",
  "Mason_thinking_at_hackathon_horizontal.webp": "mason-bair-hackathon-laptop.webp",
  "MLH_hackcon_solo.webp": "mason-bair-mlh-hackcon.webp",
  "Mason_Bair_Resume_01_20_2026.pdf": "mason-bair-resume.pdf",
  // Older résumés are still in search results, showing out-of-date facts.
  "Mason-Bair-Resume-3.pdf": "mason-bair-resume.pdf",
  "old_Mason-Bair-Resume-3.pdf": "mason-bair-resume.pdf",
};

/** Permanent redirects from each old /misc file name to its new one, so search engines move their index over. */
export function oldFileRedirects(): Redirect[] {
  return Object.entries(renamedFiles).map(([from, to]) => ({
    source: `/misc/${from}`,
    destination: `/misc/${to}`,
    permanent: true,
  }));
}
