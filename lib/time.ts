const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function unit(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"} ago`;
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "just now";
  const s = Math.floor((now.getTime() - then) / 1000);
  if (s < MIN) return "just now";
  if (s < HOUR) return unit(Math.floor(s / MIN), "minute");
  if (s < DAY) return unit(Math.floor(s / HOUR), "hour");
  if (s < 7 * DAY) return unit(Math.floor(s / DAY), "day");
  if (s < 60 * DAY) return unit(Math.floor(s / (7 * DAY)), "week");
  if (s < 365 * DAY) return unit(Math.floor(s / (30 * DAY)), "month");
  return unit(Math.floor(s / (365 * DAY)), "year");
}
