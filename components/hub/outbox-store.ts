"use client";

import { createOutbox, type Outbox, type OutboxEntry, type OutboxStatus } from "@/lib/hub/outbox";
import { sendCapture } from "@/lib/hub/send-capture";

export type OutboxView = OutboxStatus & { memoryOnly: boolean };

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

let sharedOutbox: Outbox | null = null;
let memoryOnly = false;

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

// One outbox per tab, so every flush in this tab shares the same in-progress guard.
function outbox(): Outbox {
  if (sharedOutbox) return sharedOutbox;
  let storage: KeyValueStorage;
  try {
    window.localStorage.setItem("hub-outbox-probe", "1");
    storage = window.localStorage;
  } catch {
    memoryOnly = true;
    storage = memoryStorage();
  }
  sharedOutbox = createOutbox(storage);
  return sharedOutbox;
}

const listeners = new Set<() => void>();
let snapshot: OutboxView | null = null;

function readView(): OutboxView {
  return { ...outbox().status(), memoryOnly };
}

export function publishOutbox(): void {
  snapshot = readView();
  for (const listener of listeners) listener();
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function outboxSnapshot(): OutboxView {
  snapshot ??= readView();
  return snapshot;
}

/** Sends everything waiting; storage or network errors leave entries in place for the next try. */
export function flushOutbox(): void {
  publishOutbox();
  void outbox()
    .flush((entry) => sendCapture(entry))
    .catch(() => {})
    .finally(publishOutbox);
}

/** Queues a capture and starts sending; returns false when this browser could not store it. */
export function saveToOutbox(entry: Omit<OutboxEntry, "clientKey" | "createdAt">): boolean {
  try {
    outbox().enqueue({ ...entry, clientKey: crypto.randomUUID(), createdAt: new Date().toISOString() });
  } catch {
    return false;
  }
  flushOutbox();
  return true;
}

export function retryFailedInOutbox(): void {
  try {
    outbox().retryFailed();
  } catch {
    return;
  }
  flushOutbox();
}
