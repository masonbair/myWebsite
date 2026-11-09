import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMbox, splitMbox } from "@/scripts/news-mbox";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function* chunked(data: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(data);
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const m of source) out.push(text(m));
  return out;
}

const MBOX = [
  "From 1234@xxx Mon Jan 05 10:00:00 +0000 2026",
  "Message-ID: <a@test>",
  "Subject: one",
  "",
  "Hello",
  ">From the desk of nobody",
  ">>From stays once-escaped",
  "",
  "From 5678@xxx Tue Jan 06 10:00:00 +0000 2026",
  "Message-ID: <b@test>",
  "",
  "Body From here is fine",
  "",
].join("\n");

describe("splitMbox", () => {
  it("splits on From_ lines and un-escapes >From at line start", async () => {
    for (const size of [1, 7, 4096]) {
      const messages = await collect(splitMbox(chunked(MBOX, size)));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe("Message-ID: <a@test>\nSubject: one\n\nHello\nFrom the desk of nobody\n>From stays once-escaped\n");
      expect(messages[1]).toBe("Message-ID: <b@test>\n\nBody From here is fine\n");
    }
  });

  it("handles CRLF line ends", async () => {
    const messages = await collect(splitMbox(chunked(MBOX.replace(/\n/g, "\r\n"), 5)));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("\r\nFrom the desk of nobody\r\n");
    expect(messages[1].endsWith("fine\r\n")).toBe(true);
  });

  it("ignores text before the first From_ line and yields nothing for an empty file", async () => {
    expect(await collect(splitMbox(chunked("", 3)))).toEqual([]);
    expect(await collect(splitMbox(chunked(`junk\n${MBOX}`, 3)))).toHaveLength(2);
  });
});

describe("readMbox", () => {
  it("streams messages from a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mbox-"));
    const path = join(dir, "mail.mbox");
    await writeFile(path, MBOX);
    expect(await collect(readMbox(path))).toHaveLength(2);
  });
});
