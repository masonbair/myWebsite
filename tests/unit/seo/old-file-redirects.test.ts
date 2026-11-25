import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oldFileRedirects, renamedFiles } from "@/lib/seo/old-file-redirects";

describe("oldFileRedirects", () => {
  it("sends every old name to a file that exists", () => {
    for (const to of Object.values(renamedFiles)) expect(existsSync(`public/misc/${to}`), to).toBe(true);
  });

  it("leaves no old name behind in public/misc", () => {
    for (const from of Object.keys(renamedFiles)) expect(existsSync(`public/misc/${from}`), from).toBe(false);
  });

  it("moves the old résumé that search results still show", () => {
    expect(oldFileRedirects()).toContainEqual({
      source: "/misc/Mason-Bair-Resume-3.pdf",
      destination: "/misc/mason-bair-resume.pdf",
      permanent: true,
    });
  });
});
