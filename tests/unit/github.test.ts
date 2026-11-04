import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/github-graphql.json";
import { getGithubActivity } from "@/lib/github";

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("getGithubActivity", () => {
  it("summarizes fixture", async () => {
    const f = ok(fixture);
    const r = await getGithubActivity("masonbair", f, "fake-token");
    expect(r).not.toBeNull();
    expect(r!.commits30d).toBe(5);
    expect(r!.repos30d).toBe(2);
    expect(r!.private30d).toBe(7);
    expect(r!.total30d).toBe(12);
    expect(r!.recent.length).toBe(3);
    expect(r!.recent.map((x) => x.name)).not.toContain("forked-lib");
    expect(r!.online.map((x) => x.name)).toEqual(["side-project"]);
    expect(r!.online[0].homepage).toBe("https://example.dev");
  });

  it("never leaks a private repo name", async () => {
    const r = await getGithubActivity("masonbair", ok(fixture), "fake-token");
    expect(JSON.stringify(r)).not.toContain("secret-client-repo");
  });

  it("private30d is 0 when restrictedContributionsCount is missing", async () => {
    const body = structuredClone(fixture) as { data: { user: { contributionsCollection: Record<string, unknown> } } };
    delete body.data.user.contributionsCollection.restrictedContributionsCount;
    const r = await getGithubActivity("masonbair", ok(body), "fake-token");
    expect(r!.private30d).toBe(0);
    expect(r!.total30d).toBe(5);
  });

  it("sends auth, user agent and revalidate hint", async () => {
    const f = ok(fixture);
    await getGithubActivity("masonbair", f, "fake-token");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }];
    expect(url).toBe("https://api.github.com/graphql");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("bearer fake-token");
    expect(h["User-Agent"]).toBeTruthy();
    expect(init.next).toEqual({ revalidate: 3600 });
  });

  it("sends identical bodies for calls within the same hour", async () => {
    const f = ok(fixture);
    await getGithubActivity("masonbair", f, "t", new Date("2026-11-04T12:05:01.123Z"));
    await getGithubActivity("masonbair", f, "t", new Date("2026-11-04T12:58:59.999Z"));
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][1].body).toBe(calls[1][1].body);
    const vars = JSON.parse(calls[0][1].body as string).variables;
    expect(vars.to).toBe("2026-11-04T12:00:00.000Z");
    expect(vars.from).toBe("2026-10-05T12:00:00.000Z");
  });

  it("ignores non-https homepage", async () => {
    const body = structuredClone(fixture);
    body.data.user.repositories.nodes[0].homepageUrl = "javascript:alert(1)";
    body.data.user.repositories.nodes[3].homepageUrl = "http://insecure.example.com";
    const r = await getGithubActivity("masonbair", ok(body), "fake-token");
    expect(r!.online.map((x) => x.name)).toEqual(["side-project"]);
    expect(r!.recent[0].homepage).toBeNull();
  });

  it("returns null on non-200", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 502 })) as unknown as typeof fetch;
    expect(await getGithubActivity("masonbair", f, "fake-token")).toBeNull();
  });

  it("returns null when GraphQL reports errors", async () => {
    expect(await getGithubActivity("masonbair", ok({ errors: [{ message: "x" }], data: null }), "t")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const f = vi.fn(async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await getGithubActivity("masonbair", f, "t")).toBeNull();
  });

  it("returns null on malformed body", async () => {
    expect(await getGithubActivity("masonbair", ok({ data: { user: null } }), "t")).toBeNull();
  });

  it("returns null with no token", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const f = ok(fixture);
    expect(await getGithubActivity("masonbair", f, undefined)).toBeNull();
    vi.unstubAllEnvs();
    expect(f).not.toHaveBeenCalled();
  });
});
