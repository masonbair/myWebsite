import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://clicker.masonbair.com',
  build: { format: 'file', inlineStylesheets: 'never' },
  // The CSP in vercel.json allows only same-origin scripts, so nothing may be inlined into the HTML.
  vite: { build: { assetsInlineLimit: 0 } },
  devToolbar: { enabled: false },
});
