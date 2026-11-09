// Tells Bing (and other IndexNow engines) the live pages changed. Run after a production deploy: npm run indexnow
import { pathToFileURL } from "node:url";

// The key is public by design: IndexNow proves site ownership by fetching it from the site root.
export const INDEXNOW_KEY = "ff299680043c902e40ce6cb93c5e40b2";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Builds the IndexNow POST body from a sitemap. @param siteUrl origin, e.g. https://masonbair.com @param sitemapXml sitemap.xml text */
export function indexNowPayload(siteUrl: string, sitemapXml: string) {
  const { host } = new URL(siteUrl);
  const urlList = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((url) => new URL(url).host === host);
  return { host, key: INDEXNOW_KEY, keyLocation: `${siteUrl}/${INDEXNOW_KEY}.txt`, urlList };
}

async function main(siteUrl: string) {
  const keyRes = await fetch(`${siteUrl}/${INDEXNOW_KEY}.txt`);
  if (!keyRes.ok || (await keyRes.text()).trim() !== INDEXNOW_KEY) {
    throw new Error(`Key file is not live at ${siteUrl}/${INDEXNOW_KEY}.txt; deploy first.`);
  }
  const sitemap = await fetch(`${siteUrl}/sitemap.xml`);
  if (!sitemap.ok) throw new Error(`sitemap.xml returned ${sitemap.status}`);
  const payload = indexNowPayload(siteUrl, await sitemap.text());
  if (payload.urlList.length === 0) throw new Error("No URLs found in sitemap.xml");

  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  // 200 and 202 both mean accepted; 202 means the key is still being checked.
  if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow returned ${res.status}: ${await res.text()}`);
  console.log(`IndexNow accepted ${payload.urlList.length} URLs (${res.status}): ${payload.urlList.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? "https://masonbair.com").catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
