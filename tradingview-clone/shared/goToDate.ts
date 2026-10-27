import type { Bar } from "./math.js";

/** Offset of `timeZone` from UTC at the given instant, in seconds (east positive). */
function zoneOffset(utcSeconds: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcSeconds * 1000));
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) / 1000;
  return asUtc - utcSeconds;
}

/** "2026-10-24" + "14:30" read as wall-clock time in `timeZone` → unix seconds; null when unreadable. */
export function zonedToUtc(date: string, time: string, timeZone: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || "00:00");
  if (!d || !t) return null;
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) / 1000;
  if (!Number.isFinite(naive)) return null;
  // Two passes get the offset right around daylight-saving changes.
  let utc = naive - zoneOffset(naive, timeZone);
  utc = naive - zoneOffset(utc, timeZone);
  return utc;
}

export type GoToResult = { kind: "ok"; index: number } | { kind: "before"; first: number } | { kind: "after"; last: number } | { kind: "empty" };

/** Candle that contains `time` (TradingView "Gehe zu": the bar at or before the date). */
export function findBarForDate(bars: Bar[], time: number): GoToResult {
  if (!bars.length) return { kind: "empty" };
  const step = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 0;
  if (time < bars[0].time) return { kind: "before", first: bars[0].time };
  if (time >= bars[bars.length - 1].time + Math.max(step, 1)) return { kind: "after", last: bars[bars.length - 1].time };
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return { kind: "ok", index: lo };
}
