import { describe, expect, it } from "vitest";
import { listForPage } from "@/lib/hub/page-items";
import { createFakeStore } from "./fake-store";

describe("listForPage", () => {
  it("returns every item and its count when under the limit", async () => {
    const store = createFakeStore({ kind: "mason" });
    for (let n = 0; n < 3; n++) await store.addItem({ title: `item ${n}`, source: "test" });
    const page = await listForPage(store, { state: "open" }, 5);
    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(3);
  });

  it("reports the full count when the limit cuts the list", async () => {
    const store = createFakeStore({ kind: "mason" });
    for (let n = 0; n < 5; n++) await store.addItem({ title: `item ${n}`, source: "test" });
    const page = await listForPage(store, { state: "open" }, 2);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
  });
});
