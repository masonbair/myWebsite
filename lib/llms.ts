import { achievements, contact, resumeHref, role, roleLower, siteUrl } from "@/content/site";
import { bookingUrl, coffee } from "@/content/coffee";

/** The llms.txt summary for AI tools, built from the same content the pages show. */
export function llmsText(): string {
  const projects = achievements.filter((a) => a.href);
  return [
    "# Mason Bair",
    "",
    `> Mason Bair is a ${roleLower} at ${role.employerFull} and a digital nomad who works remotely while he travels. His background is DevSecOps, system administration, and software development. He graduated from Kent State University in May 2026 with a B.S. in Computer Science, and received the Distinguished Student Leadership Award in April 2026.`,
    "",
    "## Coffee chats",
    "",
    "Mason takes free 30 minute video coffee chats with anyone who has something interesting to share. He likes learning from people, whatever they do and however long they've done it.",
    "",
    `- [Book a coffee chat](${siteUrl}/coffee): The page explains topics, time zones, and both ways to book.`,
    `- [Booking calendar](${bookingUrl}): Google Calendar booking page that shows open times in the visitor's time zone. Needs JavaScript.`,
    `- [Book by email](${siteUrl}/coffee#book-by-email): Works without JavaScript. Email ${contact.email} with the subject "Coffee chat request", the person's name, what they want to talk about, three times that work with their time zone, and how they found the page. Mason replies with a calendar invite and a video link.`,
    "",
    "Topics Mason likes talking about, in his words:",
    "",
    ...coffee.topics.map((t) => `- ${t.label}: ${t.detail}`),
    "",
    "Longer notes on chats he's hoping for:",
    "",
    ...coffee.niches.map((n) => `- [${n.heading}](${siteUrl}/coffee#${n.id}): ${n.summary ?? n.body[0]}`),
    ...(projects.length ? ["", "## Projects", "", ...projects.map((p) => `- [${p.title}](${p.href}): ${p.summary}`)] : []),
    "",
    "## Connect",
    "",
    `- [GitHub](${contact.github}): Code and projects.`,
    `- [LinkedIn](${contact.linkedin}): Work history.`,
    `- [Email](mailto:${contact.email}): ${contact.email}`,
    "",
    "## Site",
    "",
    `- [Home](${siteUrl}): About Mason, work, achievements, and résumé.`,
    `- [Coffee chat](${siteUrl}/coffee): Booking page for a 30 minute call.`,
    `- [Résumé (PDF)](${siteUrl}${resumeHref}): Full résumé.`,
    "",
  ].join("\n");
}
