import type { OutboxEntry } from "./outbox";

/** Posts one outbox entry; throws (so the entry stays waiting) when the answer is not the capture API confirming an id. */
export async function sendCapture(entry: OutboxEntry, fetchImpl: typeof fetch = fetch): Promise<number> {
  const response = await fetchImpl("/api/hub/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: entry.title, description: entry.description, clientKey: entry.clientKey }),
  });
  if (!response.ok) return response.status;
  // A login page or a captive portal can answer 200 too, so only a real id counts as saved.
  const body: unknown = await response.json().catch(() => null);
  const id = typeof body === "object" && body !== null ? (body as { id?: unknown }).id : undefined;
  if (response.redirected || typeof id !== "string" || !id) throw new Error("the capture was not confirmed");
  return response.status;
}
