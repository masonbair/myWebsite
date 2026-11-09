import { createHash } from "node:crypto";
import { convert } from "html-to-text";
import PostalMime from "postal-mime";
import type { NewsSource } from "./types";

export type ParsedEmail = {
  messageId: string;
  from: string;
  subject: string;
  date: Date | null;
  forwardedFor: string | null;
  listPost: string | null;
  html: string | null;
  text: string | null;
};

const MAX_CLEAN_CHARS = 200_000;

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function parseEmail(raw: Uint8Array): Promise<ParsedEmail> {
  const mail = await PostalMime.parse(raw);
  const header = (key: string) => mail.headers.find((h) => h.key === key)?.value.trim() || null;
  const date = mail.date ? new Date(mail.date) : null;
  const listPost = header("list-post");
  return {
    messageId: mail.messageId?.trim() || `sha256:${sha256Hex(raw)}`,
    from: (mail.from?.address ?? "").toLowerCase(),
    subject: mail.subject ?? "",
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    forwardedFor: header("x-forwarded-for"),
    listPost: listPost && !/^no$/i.test(listPost) ? listPost : null,
    html: mail.html ?? null,
    text: mail.text ?? null,
  };
}

const DROP_LINE = /unsubscribe|manage (your )?(email )?(preferences|subscription)|update (your )?(email )?preferences|view (this )?(email )?(online|in (your |a )?browser)|refer (a )?friends?|your referral link/i;
const FOOTER_LINE =
  /^(you('| a)re receiving this|you received this|this email was sent to|sent to \S+@|©|copyright\b|all rights reserved|to stop receiving|if you no longer wish|our mailing address)/i;

export function cleanText(email: ParsedEmail): string {
  let body: string;
  if (email.html) {
    body = convert(email.html, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { linkBrackets: ["(", ")"], hideLinkHrefIfSameAsText: true } },
        { selector: "img", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "script", format: "skip" },
      ],
    });
  } else {
    body = email.text ?? "";
  }
  const kept: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (FOOTER_LINE.test(trimmed)) break;
    if (DROP_LINE.test(trimmed)) continue;
    kept.push(trimmed.replace(/\((https?:\/\/[^\s)]*?)[?#][^\s)]*\)/g, "($1)").replace(/[ \t]+/g, " "));
  }
  return kept
    .join("\n")
    .replace(/[<>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CLEAN_CHARS);
}

export function matchSource(from: string, sources: NewsSource[]): NewsSource | null {
  const address = from.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);
  if (!address.includes("@") || !domain) return null;
  const active = sources.filter((s) => s.active);
  const byAddress = active.find((s) => s.senderAddresses.some((a) => a.trim().toLowerCase() === address));
  if (byAddress) return byAddress;
  return (
    active.find((s) =>
      s.senderDomains.some((d) => {
        const wanted = d.trim().toLowerCase();
        return domain === wanted || domain.endsWith(`.${wanted}`);
      }),
    ) ?? null
  );
}
