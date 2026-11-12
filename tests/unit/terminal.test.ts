import { describe, expect, it } from "vitest";
import { runCommand, type TerminalData } from "@/lib/terminal";

const data: TerminalData = {
  place: "Lisbon, Portugal",
  countries: 22,
  projects: [{ name: "justporchit", url: "https://justporchit.com" }],
  contributions30d: 1619,
};

describe("runCommand", () => {
  it("help lists every command", () => {
    const out = runCommand("help", data).join("\n");
    for (const c of ["whereami", "ls projects", "coffee", "whoami", "clear"]) expect(out).toContain(c);
  });

  it("whereami says only what the location tile shows", () => {
    expect(runCommand("whereami", data)).toEqual(["Lisbon, Portugal. 22 countries so far."]);
  });

  it("whereami without a place still answers", () => {
    expect(runCommand("whereami", { ...data, place: null })[0]).toContain("22 countries");
  });

  it("ls projects lists live projects with links", () => {
    expect(runCommand("ls projects", data)).toEqual(["justporchit  https://justporchit.com"]);
  });

  it("ls with nothing live says so", () => {
    expect(runCommand("ls", { ...data, projects: [] })[0]).toMatch(/nothing live/i);
  });

  it("coffee points at the booking page", () => {
    expect(runCommand("coffee", data).join(" ")).toContain("/coffee");
  });

  it("ignores case and extra spaces", () => {
    expect(runCommand("  WhereAmI  ", data)).toEqual(runCommand("whereami", data));
  });

  it("an unknown command suggests help and echoes nothing unsafe", () => {
    const out = runCommand("rm -rf /", data);
    expect(out).toEqual(["command not found: rm. Try help."]);
  });

  it("empty input prints nothing", () => {
    expect(runCommand("   ", data)).toEqual([]);
  });

  it("caps a very long unknown command name", () => {
    expect(runCommand("x".repeat(500), data)[0].length).toBeLessThan(80);
  });
});
