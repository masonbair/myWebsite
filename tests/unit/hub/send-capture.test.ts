import { describe, expect, it, vi } from "vitest";
import { createOutbox, type OutboxEntry } from "@/lib/hub/outbox";
import { sendCapture } from "@/lib/hub/send-capture";

const entry: OutboxEntry = {
  clientKey: "00000000-0000-4000-8000-000000000001",
  title: "capture",
  createdAt: "2026-11-04T12:00:00.000Z",
};

function answer(body: string, init: ResponseInit, redirected = false) {
  const response = new Response(body, init);
  Object.defineProperty(response, "redirected", { value: redirected });
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe("sendCapture", () => {
  it("returns the status when the api confirms an id", async () => {
    expect(await sendCapture(entry, answer('{"id":"abc"}', { status: 201 }))).toBe(201);
  });

  it("posts asIdea, false when the entry has none", async () => {
    const post = vi.fn<typeof fetch>(async () => new Response('{"id":"abc"}', { status: 201 }));
    await sendCapture({ ...entry, asIdea: true }, post);
    await sendCapture(entry, post);
    const bodies = post.mock.calls.map((c) => JSON.parse(c[1]?.body as string));
    expect(bodies.map((b) => b.asIdea)).toEqual([true, false]);
  });

  it("returns a refusal status as is", async () => {
    expect(await sendCapture(entry, answer('{"error":"unauthorized"}', { status: 401 }))).toBe(401);
  });

  it.each([
    ["a redirect", answer('{"id":"abc"}', { status: 200 }, true)],
    ["a page that is not json", answer("<html>sign in</html>", { status: 200 })],
    ["json without an id", answer("{}", { status: 200 })],
  ])("throws on %s", async (_name, fetchImpl) => {
    await expect(sendCapture(entry, fetchImpl)).rejects.toThrow(/not confirmed/);
  });

  it("keeps the outbox entry when the answer was not a confirmation", async () => {
    const outbox = createOutbox(memoryStorage());
    outbox.enqueue(entry);
    await outbox.flush((sent) => sendCapture(sent, answer("<html></html>", { status: 200 }, true)));
    expect(outbox.status()).toMatchObject({ waiting: 1, failed: [] });
  });
});
