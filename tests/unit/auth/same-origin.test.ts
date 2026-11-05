import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/auth/same-origin";

function post(origin?: string) {
  const headers = origin === undefined ? undefined : { origin };
  return new NextRequest("https://masonbair.com/api/hub/capture", { method: "POST", headers });
}

describe("isSameOriginRequest", () => {
  it("allows a request with no Origin header", () => {
    expect(isSameOriginRequest(post())).toBe(true);
  });

  it("allows the site's own origin", () => {
    expect(isSameOriginRequest(post("https://masonbair.com"))).toBe(true);
  });

  it.each(["https://evil.example", "http://masonbair.com", "https://masonbair.com.evil.example", "https://www.masonbair.com", "null"])(
    "refuses %s",
    (origin) => {
      expect(isSameOriginRequest(post(origin))).toBe(false);
    },
  );
});
