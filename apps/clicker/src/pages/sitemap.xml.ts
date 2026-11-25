import type { APIRoute } from 'astro';
import { SITE_URL } from '../content.mjs';

export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}/</loc></url></urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
