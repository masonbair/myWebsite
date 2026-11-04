import { describe, expect, it } from "vitest";
import { PHONE } from "../e2e/phone";

describe("phone guard pattern", () => {
  it.each(["555-010-0199", "555.010.0199", "555 010 0199", "(555) 010-0199", "555‐010‐0199", "call 555-010-0199."])(
    "catches %s",
    (s) => expect(s).toMatch(PHONE),
  );

  it.each([
    "2026-11-02T09:30:00Z",
    "August 2025 to May 2026",
    "3000 4000",
    "/_next/image?url=%2Fmisc%2Fa.webp&w=640&q=75 640w, /_next/image?url=%2Fmisc%2Fa.webp&w=750&q=75 750w",
    '{"width":3000,"height":4000,"count":1330}',
    "1,330 contributions, 20+ servers, $10K+",
    "0.123 456 7890",
  ])("ignores %s", (s) => expect(s).not.toMatch(PHONE));
});
