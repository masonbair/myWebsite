import { describe, expect, it } from "vitest";
import { lateTasks } from "@/lib/hub/late-migrate";
import type { Item } from "@/lib/hub/types";

const task = (id: string, title: string, labels: string[]): Pick<Item, "id" | "title" | "description" | "labels" | "due"> => ({
  id,
  title,
  description: `> quote ${id}\n\nSource: HiDock f.hda, recorded 2026-10-23T16:22:01\nhinote-ref: f.hda#todo:0`,
  labels,
  due: { date: "2026-10-26", time: null },
});

describe("lateTasks", () => {
  it("lists open hidock items ending in (late), with their quote", () => {
    const tasks = [
      task("a", "Book LA (late)", ["hidock", "todo"]),
      task("b", "Mine (late)", ["todo"]),
      task("c", "Book LA", ["hidock", "todo"]),
      task("d", "Carry the recorder (late)", ["hidock", "thought"]),
    ];
    expect(lateTasks(tasks)).toEqual([
      { id: "a", title: "Book LA (late)", quote: "quote a", due: "2026-10-26", todo: true },
      { id: "d", title: "Carry the recorder (late)", quote: "quote d", due: "2026-10-26", todo: false },
    ]);
  });
});
