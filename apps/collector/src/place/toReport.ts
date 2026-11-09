import type { PlaceRow } from '../../../../shared/collector-contract';
import { kmBetween, nearestPlace, type Point } from './nearestPlace';
import type { PrivatePlace } from './privatePlaces';

/** What leaves the phone about where Mason is: never a coordinate, and no city inside a private place. */
export type PlaceReport = { city: string | null; region: string; countryCode: string; country: string; private: boolean };

/** Null when no bundled city is near the fix, so nothing is sent. */
export function toReport(fix: Point, privatePlaces: PrivatePlace[], lookup: typeof nearestPlace = nearestPlace): PlaceReport | null {
  const found = lookup(fix);
  if (!found) return null;
  const inside = privatePlaces.some((p) => kmBetween(fix, p) <= p.radiusKm);
  return { ...found, city: inside ? null : found.city, private: inside };
}

/** The server works out the country code from the name, so the code is dropped here. */
export function toPlaceRow(report: PlaceReport, timeZone: string | null): PlaceRow {
  return { city: report.city, region: report.region, country: report.country, private: report.private, time_zone: timeZone };
}
