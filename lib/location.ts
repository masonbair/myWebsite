import type { Place } from "@/lib/now";

export function formatLocation(p: Place): string {
  if (!p.private && p.city) return `${p.city}, ${p.country}`;
  return [p.region, p.country].filter(Boolean).join(", ");
}
