export type Message = { title: string; message: string; clickUrl?: string };

/** Push a phone notification through ntfy. JSON publish, since HTTP headers can't carry non-ASCII titles. */
export async function notify(topic: string, msg: Message, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, title: msg.title, message: msg.message, click: msg.clickUrl }),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}
