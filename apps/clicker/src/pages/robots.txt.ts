import type { APIRoute } from 'astro';
import { SITE_URL } from '../content.mjs';

// AI crawlers are welcome on purpose: Mason wants the game to show up in AI answers.
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
