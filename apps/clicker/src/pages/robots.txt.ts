import type { APIRoute } from 'astro';
import { SITE_URL } from '../content.mjs';

// Same list as masonbair.com's app/robots.ts: each search and AI crawler gets an explicit allow, even ones that skip the `*` group.
const crawlers = [
  'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot',
  'PerplexityBot', 'Perplexity-User', 'Googlebot', 'Google-Extended', 'Applebot', 'Applebot-Extended', 'Bingbot',
];

export const GET: APIRoute = () =>
  new Response(
    ['User-agent: *', 'Allow: /', '', ...crawlers.map((bot) => `User-agent: ${bot}`), 'Allow: /', '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
