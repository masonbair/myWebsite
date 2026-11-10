import { describe, expect, it, vi } from "vitest";
import { fetchReadable, isBlockedAddress, pinnedLookup } from "@/lib/news/shared-fetch";

const ARTICLE = `<!doctype html><html><head><title>Page title</title></head><body>
<nav>Home | About</nav>
<article><h1>Chips get smaller</h1>
${"<p>Chip makers said on Monday that the next generation of parts will use far less power than the last one, and buyers are already lining up for them.</p>".repeat(8)}
</article></body></html>`;

function html(body: string | ReadableStream<Uint8Array>, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
}

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

const publicLookup = vi.fn(async () => ["93.184.216.34"]);

function deps(responses: Response[], lookup: (host: string) => Promise<string[]> = publicLookup) {
  const fetchFn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  return { fetchFn: fetchFn as unknown as typeof fetch & typeof fetchFn, lookup };
}

describe("fetchReadable", () => {
  it("returns the readable text and title of a normal article", async () => {
    const d = deps([html(ARTICLE)]);
    const result = await fetchReadable("https://news.example/a", d);
    expect(result?.text).toContain("Chip makers said on Monday");
    expect(result?.text).not.toContain("Home | About");
    expect(result?.title).toMatch(/Chips get smaller|Page title/);
    const [url, init] = d.fetchFn.mock.calls[0] as unknown as [string, RequestInit & { dispatcher?: unknown }];
    expect(url).toBe("https://news.example/a");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.dispatcher).toBeDefined();
  });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://0.0.0.0/",
    "http://2130706433/",
    "http://10.1.2.3/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
  ])("refuses the private literal address %s without fetching", async (url) => {
    const d = deps([html(ARTICLE)]);
    expect(await fetchReadable(url, d)).toBeNull();
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", "ftp://news.example/a", "http://news.example:8080/a", "https://user:pw@news.example/a", "not a url"])(
    "refuses %s",
    async (url) => {
      const d = deps([html(ARTICLE)]);
      expect(await fetchReadable(url, d)).toBeNull();
      expect(d.fetchFn).not.toHaveBeenCalled();
    },
  );

  it("refuses a host that resolves to a private address", async () => {
    const d = deps([html(ARTICLE)], async () => ["10.0.0.5"]);
    expect(await fetchReadable("https://inside.example/", d)).toBeNull();
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a host when any one of its addresses is private", async () => {
    const d = deps([html(ARTICLE)], async () => ["93.184.216.34", "::ffff:192.168.1.1"]);
    expect(await fetchReadable("https://mixed.example/", d)).toBeNull();
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a host that does not resolve", async () => {
    const d = deps([html(ARTICLE)], async () => []);
    expect(await fetchReadable("https://gone.example/", d)).toBeNull();
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a private host without fetching it", async () => {
    const lookup = vi.fn(async (host: string) => (host === "evil.example" ? ["127.0.0.1"] : ["93.184.216.34"]));
    const d = deps([redirect("http://evil.example/admin"), html(ARTICLE)], lookup);
    expect(await fetchReadable("https://news.example/a", d)).toBeNull();
    expect(d.fetchFn).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("evil.example");
  });

  it("refuses a redirect to a private literal address", async () => {
    const d = deps([redirect("http://169.254.169.254/"), html(ARTICLE)]);
    expect(await fetchReadable("https://news.example/a", d)).toBeNull();
    expect(d.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("follows a relative redirect against the current URL", async () => {
    const d = deps([redirect("/b", 301), redirect("c", 307), html(ARTICLE)]);
    const result = await fetchReadable("https://news.example/x/a", d);
    expect(result?.text).toContain("Chip makers");
    const urls = d.fetchFn.mock.calls.map((c) => (c as unknown[])[0]);
    expect(urls).toEqual(["https://news.example/x/a", "https://news.example/b", "https://news.example/c"]);
  });

  it("gives up after three redirects", async () => {
    const d = deps([redirect("/1"), redirect("/2"), redirect("/3"), redirect("/4"), html(ARTICLE)]);
    expect(await fetchReadable("https://news.example/", d)).toBeNull();
    expect(d.fetchFn).toHaveBeenCalledTimes(4);
  });

  it("refuses a body over 2 MB even without a Content-Length", async () => {
    const chunk = new TextEncoder().encode("<p>" + "a".repeat(64 * 1024) + "</p>");
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 40) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const d = deps([html(stream)]);
    expect(await fetchReadable("https://news.example/big", d)).toBeNull();
    expect(sent).toBeLessThan(40);
  });

  it("refuses a non-HTML response", async () => {
    const d = deps([new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } })]);
    expect(await fetchReadable("https://news.example/a.pdf", d)).toBeNull();
  });

  it("refuses an error status", async () => {
    const d = deps([html(ARTICLE, { status: 403 })]);
    expect(await fetchReadable("https://news.example/paywall", d)).toBeNull();
  });

  it("returns null when the fetch throws", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchReadable("https://news.example/a", { fetchFn: fetchFn as unknown as typeof fetch, lookup: publicLookup })).toBeNull();
  });

  it("returns null when the page never answers in time", async () => {
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const result = await fetchReadable("https://news.example/slow", {
      fetchFn: fetchFn as unknown as typeof fetch,
      lookup: publicLookup,
      timeoutMs: 20,
    });
    expect(result).toBeNull();
  });

  it("caps the text at 100,000 characters", async () => {
    const long = `<html><head><title>Long</title></head><body><article>${"<p>Words about chips and power and buyers. </p>".repeat(4000)}</article></body></html>`;
    const result = await fetchReadable("https://news.example/long", deps([html(long)]));
    expect(result?.text.length).toBe(100_000);
  });
});

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0", "10.0.0.5", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "fd12::1",
    "fe80::1", "ff02::1", "64:ff9b::a00:1", "2002:a00:1::", "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("pinnedLookup", () => {
  it("answers only with the checked addresses, whatever host is asked", async () => {
    const lookup = pinnedLookup(["93.184.216.34", "2606:4700::1111"]);
    const all = await new Promise((resolve) => lookup("other.example", { all: true }, (_err, addrs) => resolve(addrs)));
    expect(all).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
    const one = await new Promise((resolve) => lookup("x", {}, (_err, addr, family) => resolve([addr, family])));
    expect(one).toEqual(["93.184.216.34", 4]);
  });
});
