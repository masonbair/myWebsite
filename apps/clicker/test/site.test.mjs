import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { GAME, PRIVACY, SITE_URL } from '../src/content.mjs';

const dist = (path) => readFile(new URL(`../dist/${path}`, import.meta.url), 'utf8');
const pages = async () => (await readdir(new URL('../dist/', import.meta.url))).filter((f) => f.endsWith('.html'));

test('no page runs inline script or style, or loads anything from another site', async () => {
  for (const page of await pages()) {
    const html = await dist(page);
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
      assert.ok(/\bsrc="\/_astro\//.test(tag) || /type="application\/ld\+json"/.test(tag), `${page}: ${tag}`);
    }
    assert.doesNotMatch(html, /<style\b|\sstyle="/, page);
    const loads = html.match(/<(script|img)\b[^>]*\bsrc="[^"]*"|<link\b[^>]*\brel="(stylesheet|icon|preload|modulepreload)"[^>]*>/g) ?? [];
    for (const tag of loads) assert.doesNotMatch(tag, /(src|href)="(https?:)?\/\//, `${page}: ${tag}`);
  }
});

test('the home page has the search and social basics', async () => {
  const html = await dist('index.html');
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  for (const pattern of [
    /<title>[^<]{20,65}<\/title>/,
    /<meta name="description" content="[^"]{70,160}"/,
    new RegExp(`<link rel="canonical" href="${SITE_URL}/"`),
    /<meta property="og:image" content="https:\/\/[^"]+\/og\.jpg"/,
    /<meta name="twitter:card" content="summary_large_image"/,
    /<html lang="en"/,
  ]) assert.match(html, pattern);
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /alt="[^"]{10,}"[^>]*width="\d+"[^>]*height="\d+"|width="\d+"[^>]*height="\d+"[^>]*alt="[^"]{10,}"/, img);
});

test('structured data names the game and links Mason to masonbair.com', async () => {
  const html = await dist('index.html');
  const json = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const byType = Object.fromEntries(json['@graph'].map((n) => [n['@type'], n]));
  assert.equal(byType.VideoGame.name, GAME.name);
  assert.equal(byType.VideoGame.author['@id'], 'https://masonbair.com/#person');
  assert.equal(byType.Person.url, 'https://masonbair.com');
  assert.ok(byType.FAQPage.mainEntity.length >= 3);
});

test('the page links back to masonbair.com from the name sticker and the footer', async () => {
  const html = await dist('index.html');
  assert.ok((html.match(/href="https:\/\/masonbair\.com"/g) ?? []).length >= 3);
});

test('robots, sitemap and llms.txt are served and point at this site', async () => {
  assert.match(await dist('robots.txt'), new RegExp(`Sitemap: ${SITE_URL}/sitemap.xml`));
  assert.match(await dist('sitemap.xml'), new RegExp(`<loc>${SITE_URL}/</loc>`));
  const llms = await dist('llms.txt');
  assert.match(llms, new RegExp(`^# ${GAME.name}\\n\\n> `));
  assert.match(llms, /https:\/\/masonbair\.com/);
});

test('the game name lives only in src/content.mjs', async () => {
  const files = ['src/pages/index.astro', 'src/pages/404.astro', 'src/pages/privacy.astro', 'src/layouts/Base.astro', 'src/pages/llms.txt.ts'];
  for (const file of files) assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), new RegExp(GAME.name, 'i'), file);
});

test('the privacy policy is served at /privacy, linked from the home page and listed in the sitemap', async () => {
  const html = await dist('privacy.html');
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE_URL}/privacy"`));
  assert.doesNotMatch(html, /name="robots" content="noindex"/);
  for (const phrase of ['collects no personal data', 'no network requests', 'In-app purchases may come', 'masonbair.com']) assert.ok(html.includes(phrase), phrase);
  assert.match(html, new RegExp(`<time datetime="${PRIVACY.updated.iso}"`));
  assert.match(await dist('index.html'), /href="\/privacy"/);
  assert.match(await dist('sitemap.xml'), new RegExp(`<loc>${SITE_URL}/privacy</loc>`));
});
