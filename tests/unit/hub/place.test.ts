import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { readPrivatePlace } from "@/lib/hub/place";

type PlaceRow = { city: string | null; region: string; country: string; private: boolean; sent_private: boolean; updated_at: string };
const NOW = new Date("2026-11-17T12:00:00Z");
const FRESH = "2026-11-16T12:00:00Z";

function fakeClient(place: PlaceRow | null, zone: string | null, zoneUpdatedAt = FRESH) {
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => ({ data, error: null });
    return c;
  };
  return {
    rpc: () => chain(place),
    from: (table: string) => chain(table === "now_place" ? (zone ? { time_zone: zone, updated_at: zoneUpdatedAt } : null) : null),
  } as unknown as SupabaseClient;
}

const publicRow: PlaceRow = { city: "Denver", region: "CO", country: "USA", private: false, sent_private: false, updated_at: FRESH };
const privateRow: PlaceRow = { city: null, region: "Ohio", country: "USA", private: true, sent_private: true, updated_at: FRESH };

afterEach(() => {
  delete process.env.HUB_TIME_ZONE;
});

describe("readPrivatePlace", () => {
  it("returns the city, region and zone of a public place", async () => {
    expect(await readPrivatePlace(fakeClient(publicRow, "America/Chicago"), NOW)).toEqual({
      city: "Denver",
      region: "CO",
      country: "USA",
      timeZone: "America/Chicago",
      private: false,
      updatedAt: FRESH,
    });
  });

  it("keeps the city null inside a private place", async () => {
    const place = await readPrivatePlace(fakeClient(privateRow, "America/New_York"), NOW);
    expect(place).toMatchObject({ city: null, region: "Ohio", country: "USA", private: true });
    expect(place).not.toHaveProperty("sentPrivate");
  });

  it("is null when there is no place row", async () => {
    expect(await readPrivatePlace(fakeClient(null, null), NOW)).toBeNull();
  });

  it("falls back to HUB_TIME_ZONE, then America/Denver, when the ping has no usable zone", async () => {
    expect((await readPrivatePlace(fakeClient(publicRow, null), NOW))?.timeZone).toBe("America/Denver");
    process.env.HUB_TIME_ZONE = "Europe/Paris";
    expect((await readPrivatePlace(fakeClient(publicRow, null), NOW))?.timeZone).toBe("Europe/Paris");
    expect((await readPrivatePlace(fakeClient(publicRow, "America/Chicago", "2026-10-01T00:00:00Z"), NOW))?.timeZone).toBe("Europe/Paris");
  });
});
