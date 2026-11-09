import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox, type OutboxEntry } from "@/lib/hub/outbox";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const entry = (n: number): OutboxEntry => ({
  clientKey: `00000000-0000-4000-8000-00000000000${n}`,
  title: `capture ${n}`,
  createdAt: "2026-11-04T12:00:00.000Z",
});

describe("outbox", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("keeps an entry when the send fails", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await outbox.flush(offline)).toBe(0);
    expect(await outbox.flush(async () => 503)).toBe(0);
    expect(outbox.status()).toMatchObject({ waiting: 1, failed: [] });
  });

  it("keeps asIdea across a reload", () => {
    createOutbox(storage).enqueue({ ...entry(1), asIdea: true });
    expect(createOutbox(storage).entries()[0].asIdea).toBe(true);
  });

  it("removes an entry after a 2xx", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    expect(await outbox.flush(async () => 201)).toBe(1);
    expect(outbox.status().waiting).toBe(0);
  });

  it("sends once when flushed twice after one success", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    const send = vi.fn(async () => 201);
    await outbox.flush(send);
    await outbox.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never sends the same entry twice when a second flush starts while one is running", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    let release: (status: number) => void = () => {};
    const send = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));
    const first = outbox.flush(send);
    const second = outbox.flush(send);
    release(201);
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.status().waiting).toBe(0);
  });

  it("sends an entry saved while a flush is running, in the same flush call chain", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    let release: (status: number) => void = () => {};
    const send = vi.fn((sent: OutboxEntry) =>
      sent.clientKey === entry(1).clientKey ? new Promise<number>((resolve) => (release = resolve)) : Promise.resolve(201),
    );
    const first = outbox.flush(send);
    outbox.enqueue(entry(2));
    const second = outbox.flush(send);
    release(201);
    await Promise.all([first, second]);
    expect(send.mock.calls.map(([sent]) => sent.title)).toEqual(["capture 1", "capture 2"]);
    expect(outbox.status().waiting).toBe(0);
  });

  it("stops at the first retryable failure and keeps order", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    outbox.enqueue(entry(2));
    const send = vi.fn(async () => 429);
    await outbox.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.entries().map((e) => e.title)).toEqual(["capture 1", "capture 2"]);
  });

  it("keeps a refused entry, stops retrying it, and sends the rest", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    outbox.enqueue(entry(2));
    const send = vi.fn(async (sent: OutboxEntry) => (sent.title === "capture 1" ? 400 : 201));
    expect(await outbox.flush(send)).toBe(1);
    expect(outbox.status()).toMatchObject({ waiting: 0, failed: [{ title: "capture 1", failedStatus: 400 }] });
    await outbox.flush(send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("can retry a refused entry on request", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    await outbox.flush(async () => 422);
    outbox.retryFailed();
    expect(await outbox.flush(async () => 201)).toBe(1);
    expect(outbox.status()).toMatchObject({ waiting: 0, failed: [] });
  });

  it("keeps entries waiting and asks for sign in on 401 or 403", async () => {
    const outbox = createOutbox(storage);
    outbox.enqueue(entry(1));
    await outbox.flush(async () => 401);
    expect(outbox.status()).toMatchObject({ waiting: 1, failed: [], needsSignIn: true });
    await outbox.flush(async () => 201);
    expect(outbox.status()).toMatchObject({ waiting: 0, needsSignIn: false });
  });

  it("survives a reload: a new outbox on the same storage sees the queue", async () => {
    createOutbox(storage).enqueue(entry(1));
    expect(createOutbox(storage).status().waiting).toBe(1);
  });

  it("treats unreadable storage as an empty queue instead of crashing", () => {
    storage.setItem("hub-outbox", "{not json");
    expect(createOutbox(storage).status().waiting).toBe(0);
  });
});
