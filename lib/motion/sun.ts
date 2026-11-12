export type SunPhase = "dawn" | "day" | "dusk" | "night";

/** Where the sun is for someone `offsetMinutes` east of UTC: dawn 5–8, day 8–17, dusk 17–20, night otherwise. */
export function sunPhase(offsetMinutes: number, now: Date): SunPhase {
  const minutes = (((now.getUTCHours() * 60 + now.getUTCMinutes() + offsetMinutes) % 1440) + 1440) % 1440;
  const hour = minutes / 60;
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}
