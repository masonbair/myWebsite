import { describe, expect, it } from "vitest";
import { notify } from "@/lib/hub/notify";

describe("notify", () => {
  it("publishes JSON so non-ASCII titles survive", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}");
    }) as unknown as typeof fetch;

    await notify("topic-x", { title: "Done: Café 🎃", message: "m", clickUrl: "https://t/1" }, fetchFn);

    expect(calls[0].url).toBe("https://ntfy.sh/");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      topic: "topic-x",
      title: "Done: Café 🎃",
      message: "m",
      click: "https://t/1",
    });
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
    await expect(notify("t", { title: "a", message: "b" }, fetchFn)).rejects.toThrow("429");
  });
});
