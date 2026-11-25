import { defineConfig } from 'astro/config';
import { SITE_URL } from './src/content.mjs';

export default defineConfig({
  site: SITE_URL,
  build: { format: 'file', inlineStylesheets: 'never' },
  // The CSP in vercel.json allows only same-origin scripts, so nothing may be inlined into the HTML.
  vite: { build: { assetsInlineLimit: 0 } },
  devToolbar: { enabled: false },
});
