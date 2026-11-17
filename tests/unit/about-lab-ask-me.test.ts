import { describe, expect, it } from "vitest";
import { buildAnswers, DEFAULT_ANSWER } from "@/components/about-lab/ask-me/answers";

const place = { city: "Zipolite", region: "Oaxaca", country: "Mexico", private: false, updatedAt: "2026-11-01T00:00:00Z" };

describe("ask-me answers", () => {
  it("has unique, CSS-safe ids and includes the default answer", () => {
    const ids = buildAnswers({ place: null, countriesVisited: 23, bake: null }).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_ANSWER);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
  });

  it("shows the current place, or a vague line when there is none", () => {
    const where = (p: typeof place | null) => buildAnswers({ place: p, countriesVisited: 23, bake: null }).find((a) => a.id === "where");
    expect(where(place)?.big).toBe("Zipolite, Mexico");
    expect(where(null)?.big).toBe("Somewhere new");
  });

  it("keeps the region only for a private place", () => {
    const answers = buildAnswers({ place: { ...place, private: true }, countriesVisited: 23, bake: null });
    expect(JSON.stringify(answers)).not.toContain("Zipolite");
  });

  it("drops the country count when it is unknown", () => {
    const answers = buildAnswers({ place: null, countriesVisited: 0, bake: null });
    expect(JSON.stringify(answers)).not.toMatch(/0 countries/);
  });
});
