import { describe, expect, it } from "vitest";
import { GET } from "@/app/hub/missing/route";

describe("GET /hub/missing", () => {
  it("answers 404 with a page that needs no JavaScript", async () => {
    const res = GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("<h1>Page not found</h1>");
    expect(html).toContain('href="/hub/login"');
    expect(html).not.toContain("<script");
  });
});
