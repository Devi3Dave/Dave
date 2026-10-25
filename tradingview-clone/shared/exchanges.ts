// Stock exchange trading hours. Times are wall-clock times in the exchange's own
// time zone; conversion to UTC goes through Intl, so daylight saving changes on
// either side (exchange or viewer) come out right. Public holidays are not known.

export interface Exchange {
  id: string;
  name: string;
  short: string;
  city: string;
  country: string;
  timeZone: string;
  /** Regular session as local "HH:MM". */
  open: string;
  close: string;
  /** Midday break (Asian exchanges). */
  lunch?: { start: string; end: string };
  color: string;
}

export const EXCHANGES: Exchange[] = [
  { id: "nyse", name: "New York Stock Exchange", short: "NYSE", city: "New York", country: "🇺🇸", timeZone: "America/New_York", open: "09:30", close: "16:00", color: "#2962ff" },
  { id: "nasdaq", name: "Nasdaq Stock Market", short: "Nasdaq", city: "New York", country: "🇺🇸", timeZone: "America/New_York", open: "09:30", close: "16:00", color: "#00bcd4" },
  { id: "tsx", name: "Toronto Stock Exchange", short: "TSX", city: "Toronto", country: "🇨🇦", timeZone: "America/Toronto", open: "09:30", close: "16:00", color: "#e91e63" },
  { id: "lse", name: "London Stock Exchange", short: "LSE", city: "London", country: "🇬🇧", timeZone: "Europe/London", open: "08:00", close: "16:30", color: "#9c27b0" },
  { id: "xetra", name: "Xetra (Deutsche Börse)", short: "Xetra", city: "Frankfurt", country: "🇩🇪", timeZone: "Europe/Berlin", open: "09:00", close: "17:30", color: "#f5c518" },
  { id: "fra", name: "Börse Frankfurt (Parkett)", short: "Frankfurt", city: "Frankfurt", country: "🇩🇪", timeZone: "Europe/Berlin", open: "08:00", close: "22:00", color: "#ffb74d" },
  { id: "euronext", name: "Euronext Paris", short: "Euronext", city: "Paris", country: "🇫🇷", timeZone: "Europe/Paris", open: "09:00", close: "17:30", color: "#7e57c2" },
  { id: "six", name: "SIX Swiss Exchange", short: "SIX", city: "Zürich", country: "🇨🇭", timeZone: "Europe/Zurich", open: "09:00", close: "17:30", color: "#ef5350" },
  { id: "tse", name: "Tokyo Stock Exchange", short: "Tokio", city: "Tokio", country: "🇯🇵", timeZone: "Asia/Tokyo", open: "09:00", close: "15:30", lunch: { start: "11:30", end: "12:30" }, color: "#ff7043" },
  { id: "hkex", name: "Hong Kong Exchange", short: "HKEX", city: "Hongkong", country: "🇭🇰", timeZone: "Asia/Hong_Kong", open: "09:30", close: "16:00", lunch: { start: "12:00", end: "13:00" }, color: "#26a69a" },
  { id: "sse", name: "Shanghai Stock Exchange", short: "Shanghai", city: "Shanghai", country: "🇨🇳", timeZone: "Asia/Shanghai", open: "09:30", close: "15:00", lunch: { start: "11:30", end: "13:00" }, color: "#d32f2f" },
  { id: "szse", name: "Shenzhen Stock Exchange", short: "Shenzhen", city: "Shenzhen", country: "🇨🇳", timeZone: "Asia/Shanghai", open: "09:30", close: "15:00", lunch: { start: "11:30", end: "13:00" }, color: "#c2185b" },
  { id: "krx", name: "Korea Exchange", short: "KRX", city: "Seoul", country: "🇰🇷", timeZone: "Asia/Seoul", open: "09:00", close: "15:30", color: "#5c6bc0" },
  { id: "sgx", name: "Singapore Exchange", short: "SGX", city: "Singapur", country: "🇸🇬", timeZone: "Asia/Singapore", open: "09:00", close: "17:00", lunch: { start: "12:00", end: "13:00" }, color: "#8d6e63" },
  { id: "nse", name: "National Stock Exchange of India", short: "NSE", city: "Mumbai", country: "🇮🇳", timeZone: "Asia/Kolkata", open: "09:15", close: "15:30", color: "#ff9800" },
  { id: "asx", name: "Australian Securities Exchange", short: "ASX", city: "Sydney", country: "🇦🇺", timeZone: "Australia/Sydney", open: "10:00", close: "16:00", color: "#66bb6a" },
];

export function getExchange(id: string): Exchange | undefined {
  return EXCHANGES.find((e) => e.id === id);
}

/** The device's IANA time zone. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormat(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    partsCache.set(tz, f);
  }
  return f;
}

interface Wall {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
}

/** Wall-clock time in a zone at a UTC instant (ms). */
export function wallTime(ms: number, tz: string): Wall {
  const p: Record<string, number> = {};
  for (const part of partsFormat(tz).formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year, m: p.month, d: p.day, hh: p.hour % 24, mm: p.minute };
}

/** Offset of a zone from UTC at an instant, in minutes (Berlin in winter: 60). */
export function zoneOffset(ms: number, tz: string): number {
  const w = wallTime(ms, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** UTC instant (ms) of a wall-clock time in a zone. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - zoneOffset(guess, tz) * 60000;
  const second = guess - zoneOffset(first, tz) * 60000;
  return second;
}

const hm = (s: string) => s.split(":").map(Number) as [number, number];

export interface TradingDay {
  /** Local date at the exchange, "YYYY-MM-DD". */
  date: string;
  open: number; // unix seconds
  close: number;
  /** Trading parts (two when there is a lunch break). */
  parts: { start: number; end: number }[];
}

/** Regular trading days (Mon-Fri, holidays not known) that overlap [from, to] (unix seconds). */
export function tradingDays(ex: Exchange, from: number, to: number): TradingDay[] {
  const out: TradingDay[] = [];
  const start = wallTime((from - 86400) * 1000, ex.timeZone);
  const end = wallTime((to + 86400) * 1000, ex.timeZone);
  const endKey = Date.UTC(end.y, end.m - 1, end.d);
  for (let day = Date.UTC(start.y, start.m - 1, start.d); day <= endKey; day += 86400000) {
    const date = new Date(day);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const at = (t: string) => zonedToUtc(y, m, d, ...hm(t), ex.timeZone) / 1000;
    const open = at(ex.open);
    const close = at(ex.close);
    if (close < from || open > to) continue;
    const parts = ex.lunch
      ? [
          { start: open, end: at(ex.lunch.start) },
          { start: at(ex.lunch.end), end: close },
        ]
      : [{ start: open, end: close }];
    out.push({ date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, open, close, parts });
  }
  return out;
}

export type MarketPhase = "open" | "lunch" | "closed";

export interface MarketStatus {
  phase: MarketPhase;
  /** When the phase changes next (unix seconds). */
  next: number;
  /** Today's (or the next) trading day. */
  day: TradingDay | null;
}

export function marketStatus(ex: Exchange, now: number): MarketStatus {
  const days = tradingDays(ex, now - 86400, now + 10 * 86400);
  for (const day of days) {
    if (now >= day.close) continue;
    if (now < day.open) return { phase: "closed", next: day.open, day };
    const part = day.parts.find((p) => now >= p.start && now < p.end);
    if (part) return { phase: "open", next: part.end, day };
    const after = day.parts.find((p) => p.start > now);
    return { phase: "lunch", next: after?.start ?? day.close, day };
  }
  return { phase: "closed", next: now, day: null };
}

/** Clock time of an instant in a zone, "HH:MM". */
export function clock(sec: number, tz: string): string {
  const w = wallTime(sec * 1000, tz);
  return `${String(w.hh).padStart(2, "0")}:${String(w.mm).padStart(2, "0")}`;
}

/** Days between the exchange's trading date and the date the viewer sees (-1, 0, +1). */
export function dayShift(sec: number, exchangeDate: string, tz: string): number {
  const w = wallTime(sec * 1000, tz);
  const [y, m, d] = exchangeDate.split("-").map(Number);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d) - Date.UTC(y, m - 1, d)) / 86400000);
}

export interface ClockChange {
  /** First trading day whose local open/close differs from today's. */
  date: string;
  open: string;
  close: string;
}

/**
 * The next day the session moves on the viewer's clock, as happens when only one
 * side switches to or from daylight saving time (e.g. Europe a week before the US).
 */
export function nextClockChange(ex: Exchange, now: number, tz: string, horizonDays = 200): ClockChange | null {
  const days = tradingDays(ex, now, now + horizonDays * 86400).filter((d) => d.close > now);
  if (days.length === 0) return null;
  const key = (d: TradingDay) => `${clock(d.open, tz)}-${clock(d.close, tz)}`;
  const first = key(days[0]);
  const changed = days.find((d) => key(d) !== first);
  return changed ? { date: changed.date, open: clock(changed.open, tz), close: clock(changed.close, tz) } : null;
}

/** "2 h 05 min" style duration. */
export function formatDuration(sec: number): string {
  const min = Math.max(0, Math.round(sec / 60));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d} T ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m} min`;
}
