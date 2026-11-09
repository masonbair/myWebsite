import { MAX_DESCRIPTION, MAX_TITLE } from "./input";

export type Capture = { title: string; description: string; clientKey: string; asIdea: boolean };
export type CaptureText = { title: string; description: string };
export type SharedFields = { title?: string; text?: string; url?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new Error(`bad capture: ${message}`);
}

/** Checks a capture posted by the browser; nothing in it is trusted. */
export function parseCapture(raw: unknown): Capture {
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const input = raw as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > MAX_TITLE) fail("title");
  const description = input.description ?? "";
  if (typeof description !== "string" || description.length > MAX_DESCRIPTION) fail("description");
  if (typeof input.clientKey !== "string" || !UUID.test(input.clientKey)) fail("clientKey");
  const asIdea = input.asIdea ?? false;
  if (typeof asIdea !== "boolean") fail("asIdea");
  return { title, description, clientKey: input.clientKey, asIdea };
}

/** First line becomes the title; when it is too long, the title is cut and the full text goes in the description. */
export function splitCapture(text: string): CaptureText {
  const trimmed = text.trim();
  const [firstLine = "", ...rest] = trimmed.split("\n");
  const title = firstLine.trim();
  if (title.length > MAX_TITLE) return { title: `${title.slice(0, MAX_TITLE - 3).trimEnd()}...`, description: trimmed };
  return { title, description: rest.join("\n").trim() };
}

/** Shared title, text and link become one inbox item, with the link always in the description. */
export function captureFromShare(shared: SharedFields): CaptureText {
  const text = shared.text?.trim() ?? "";
  const url = shared.url?.trim() ?? "";
  const description = [text, url && !text.includes(url) ? url : ""].filter(Boolean).join("\n\n").slice(0, MAX_DESCRIPTION);
  const title = shared.title?.trim() || splitCapture(text).title || url;
  return { title: splitCapture(title).title, description };
}
