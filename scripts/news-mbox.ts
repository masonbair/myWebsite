import { createReadStream } from "node:fs";

const FROM = new TextEncoder().encode("From ");

function startsWithFrom(line: Uint8Array, offset: number): boolean {
  if (line.length < offset + FROM.length) return false;
  for (let i = 0; i < FROM.length; i++) if (line[offset + i] !== FROM[i]) return false;
  return true;
}

function isEscapedFrom(line: Uint8Array): boolean {
  let i = 0;
  while (line[i] === 0x3e) i++;
  return i > 0 && startsWithFrom(line, i);
}

function stripLineEnd(line: Uint8Array): Uint8Array {
  let end = line.length;
  if (line[end - 1] === 0x0a) end--;
  if (line[end - 1] === 0x0d) end--;
  return line.subarray(0, end);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function* lines(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let carry: Uint8Array = new Uint8Array(0);
  for await (const chunk of chunks) {
    const data = carry.length ? concat([carry, chunk]) : chunk;
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0x0a) {
        yield data.slice(start, i + 1);
        start = i + 1;
      }
    }
    carry = data.slice(start);
  }
  if (carry.length) yield carry;
}

/** Splits a byte stream in mbox format into raw messages, undoing the ">From " escape; for tests and readMbox. */
export async function* splitMbox(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let message: Uint8Array[] | null = null;
  for await (const line of lines(chunks)) {
    if (startsWithFrom(line, 0)) {
      if (message) yield trimSeparator(message);
      message = [];
      continue;
    }
    if (!message) continue;
    message.push(isEscapedFrom(line) ? line.subarray(1) : line);
  }
  if (message) yield trimSeparator(message);
}

// mbox puts one blank line between messages; it belongs to the format, not the message.
function trimSeparator(parts: Uint8Array[]): Uint8Array {
  const last = parts[parts.length - 1];
  if (last && stripLineEnd(last).length === 0) parts.pop();
  return concat(parts);
}

/** Streams a Google Takeout .mbox file one raw message at a time, never holding the whole file in memory. */
export function readMbox(path: string): AsyncIterable<Uint8Array> {
  return splitMbox(createReadStream(path, { highWaterMark: 1 << 20 }));
}
