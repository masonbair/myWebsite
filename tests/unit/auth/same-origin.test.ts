import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/auth/same-origin";

function post(origin?: string) {
  const headers = origin === undefined ? undefined : { origin };
  return new NextRequest("https://masonbair.com/api/hub/capture", { method: "POST", headers });
}

const FOREIGN = ["https://evil.example", "http://masonbair.com", "https://masonbair.com.evil.example", "https://www.masonbair.com"];

describe("isSameOriginRequest", () => {
  it("allows a request with no Origin header", () => {
    expect(isSameOriginRequest(post())).toBe(true);
    expect(isSameOriginRequest(post(), { allowNullOrigin: true })).toBe(true);
  });

  it("allows the site's own origin", () => {
    expect(isSameOriginRequest(post("https://masonbair.com"))).toBe(true);
  });

  it.each(FOREIGN)("refuses %s", (origin) => {
    expect(isSameOriginRequest(post(origin))).toBe(false);
  });

  it.each(FOREIGN)("refuses %s even when null is allowed", (origin) => {
    expect(isSameOriginRequest(post(origin), { allowNullOrigin: true })).toBe(false);
  });

  it("refuses Origin null by default", () => {
    expect(isSameOriginRequest(post("null"))).toBe(false);
  });

  it("allows Origin null only with the share option", () => {
    expect(isSameOriginRequest(post("null"), { allowNullOrigin: true })).toBe(true);
  });
});
