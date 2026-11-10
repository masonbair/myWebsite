import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmailText } from "@/components/hub/EmailText";

describe("EmailText", () => {
  it("renders a confirmation address as a safe new-tab link and escapes markup", () => {
    const url = "https://mail-settings.google.com/mail/vf-abc?x=1&y=2";
    const html = renderToStaticMarkup(createElement(EmailText, { text: `Confirm:\n${url}\n<script>alert(1)</script>` }));
    expect(html).toContain(`href="https://mail-settings.google.com/mail/vf-abc?x=1&amp;y=2"`);
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
