import type { APIRoute } from 'astro';
import { COPY, GAME, LINKS, PRIVACY, SITE_URL } from '../content.mjs';

/** The llms.txt summary for AI tools, built from the same words the page shows. */
export const GET: APIRoute = () => {
  const text = [
    `# ${GAME.name}`,
    '',
    `> ${COPY.faq[0].a}`,
    '',
    '## Quick answers',
    '',
    ...COPY.faq.flatMap(({ q, a }) => [`### ${q}`, '', a, '']),
    '## About the game',
    '',
    ...COPY.cards.map((c) => `- ${c.title}: ${c.body}`),
    '',
    '## Links',
    '',
    `- [${GAME.name}](${SITE_URL}/): The game's page, with screenshots.`,
    `- [${PRIVACY.title}](${SITE_URL}/privacy): ${PRIVACY.description}`,
    `- [Mason Bair](${LINKS.mason}): The person making the game.`,
    '',
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
