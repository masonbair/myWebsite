import type { Place } from "@/lib/now";

export function formatLocation(p: Place): string {
  if (!p.private) return `${p.city}, ${p.country}`;
  return [p.region, p.country].filter(Boolean).join(", ");
}
