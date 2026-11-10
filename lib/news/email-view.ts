import { convert } from "html-to-text";
import type { ParsedEmail } from "./email";

export const MAX_SHOWN_CHARS = 100_000;

export type Segment = { type: "text" | "link"; value: string };

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const TRAILING = /[.,;:!?]+$/;

/** Splits plain text into text and link pieces; only http and https addresses become links. */
export function linkSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING, "");
    const start = match.index;
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    out.push({ type: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** The text part, or the html part turned into text with link addresses kept; never html. */
export function emailPlainText(email: Pick<ParsedEmail, "text" | "html">): string {
  const body = email.text
    ? email.text
    : email.html
      ? convert(email.html, {
          wordwrap: false,
          selectors: [
            { selector: "a", options: { linkBrackets: ["(", ")"], hideLinkHrefIfSameAsText: true } },
            { selector: "img", format: "skip" },
            { selector: "style", format: "skip" },
            { selector: "script", format: "skip" },
          ],
        })
      : "";
  return body.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_SHOWN_CHARS);
}
