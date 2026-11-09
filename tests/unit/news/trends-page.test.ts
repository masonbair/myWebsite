import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/news/public", () => ({ readPublicTrends: vi.fn(async () => null) }));

const { default: TrendsPage } = await import("@/app/trends/page");

describe("/trends with no data", () => {
  it("renders the empty state instead of crashing", async () => {
    const html = renderToStaticMarkup(await TrendsPage());
    expect(html).toContain("Nothing to show yet.");
    expect(html).toContain("Nothing is clearly rising right now.");
  });
});
