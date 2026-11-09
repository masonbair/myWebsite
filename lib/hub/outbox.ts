export type OutboxEntry = {
  clientKey: string;
  title: string;
  description?: string;
  /** Absent in entries stored before Save as idea existed; those count as false. */
  asIdea?: boolean;
  createdAt: string;
  /** Set when the server refused the entry outright; it stays here, unsent, until Mason retries it. */
  failedStatus?: number;
};

/** Sends one entry and returns the HTTP status; throws when the network is down. */
export type SendEntry = (entry: OutboxEntry) => Promise<number>;

export type OutboxStatus = { waiting: number; failed: OutboxEntry[]; needsSignIn: boolean };

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "hub-outbox";

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function needsSignIn(status: number): boolean {
  return status === 401 || status === 403;
}

/** Captures kept in the browser until a 2xx; any 4xx but 401/403/408/429 marks an entry failed, kept and not retried. */
export function createOutbox(storage: KeyValueStorage) {
  let running: Promise<number> | null = null;
  let rerun = false;
  let signInNeeded = false;

  function read(): OutboxEntry[] {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      return [];
    }
  }

  function write(entries: OutboxEntry[]): void {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function update(clientKey: string, change: (entry: OutboxEntry) => OutboxEntry | null): void {
    write(read().flatMap((entry) => (entry.clientKey === clientKey ? (change(entry) ?? []) : [entry])));
  }

  async function onePass(send: SendEntry): Promise<number> {
    let sent = 0;
    const done = new Set<string>();
    for (;;) {
      const next = read().find((entry) => entry.failedStatus === undefined && !done.has(entry.clientKey));
      if (!next) return sent;
      done.add(next.clientKey);
      let status: number;
      try {
        status = await send(next);
      } catch {
        return sent;
      }
      if (status >= 200 && status < 300) {
        signInNeeded = false;
        update(next.clientKey, () => null);
        sent += 1;
      } else if (needsSignIn(status)) {
        signInNeeded = true;
        return sent;
      } else if (isRetryable(status)) {
        return sent;
      } else {
        update(next.clientKey, (entry) => ({ ...entry, failedStatus: status }));
      }
    }
  }

  async function run(send: SendEntry): Promise<number> {
    let total = 0;
    do {
      rerun = false;
      total += await onePass(send);
    } while (rerun);
    return total;
  }

  return {
    enqueue(entry: OutboxEntry): void {
      write([...read(), entry]);
    },

    entries(): OutboxEntry[] {
      return read();
    },

    /** Sends waiting entries in order; a call made while a flush runs joins it instead of sending in parallel. */
    flush(send: SendEntry): Promise<number> {
      if (running) {
        rerun = true;
        return running;
      }
      running = run(send).finally(() => {
        running = null;
      });
      return running;
    },

    retryFailed(): void {
      write(read().map((entry) => ({ ...entry, failedStatus: undefined })));
    },

    status(): OutboxStatus {
      const entries = read();
      const failed = entries.filter((entry) => entry.failedStatus !== undefined);
      return { waiting: entries.length - failed.length, failed, needsSignIn: signInNeeded };
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
