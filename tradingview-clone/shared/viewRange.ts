import type { Bar } from "./math.js";

// Visible part of the chart: how much time the x axis shows and which prices the y axis shows.
// Like TradingView's date-range buttons (1D, 5D, 1M …) and its "Gehe zu → Benutzerdefinierter
// Bereich", plus a manual price range (TradingView: drag the price scale, "Auto (fits data to screen)").

export type SpanUnit = "m" | "h" | "d" | "w" | "M" | "y";

export const SPAN_UNITS: { id: SpanUnit; label: string; seconds: number }[] = [
  { id: "m", label: "Minuten", seconds: 60 },
  { id: "h", label: "Stunden", seconds: 3600 },
  { id: "d", label: "Tage", seconds: 86400 },
  { id: "w", label: "Wochen", seconds: 7 * 86400 },
  // Average lengths: a month is 1/12 of a Gregorian year, a year 365.2425 days.
  { id: "M", label: "Monate", seconds: 2629746 },
  { id: "y", label: "Jahre", seconds: 31556952 },
];

export const SPAN_PRESETS: { label: string; value: number; unit: SpanUnit }[] = [
  { label: "15 Min", value: 15, unit: "m" },
  { label: "1 Std", value: 1, unit: "h" },
  { label: "2 Std", value: 2, unit: "h" },
  { label: "4 Std", value: 4, unit: "h" },
  { label: "12 Std", value: 12, unit: "h" },
  { label: "1 Tag", value: 1, unit: "d" },
  { label: "2 Tage", value: 2, unit: "d" },
  { label: "5 Tage", value: 5, unit: "d" },
  { label: "1 Woche", value: 1, unit: "w" },
  { label: "1 Monat", value: 1, unit: "M" },
  { label: "3 Monate", value: 3, unit: "M" },
  { label: "6 Monate", value: 6, unit: "M" },
  { label: "1 Jahr", value: 1, unit: "y" },
  { label: "5 Jahre", value: 5, unit: "y" },
];

/** Seconds for `value` units; null for a value that is not a positive number. */
export function spanSeconds(value: number, unit: SpanUnit): number | null {
  const u = SPAN_UNITS.find((x) => x.id === unit);
  if (!u || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * u.seconds);
}

/** The largest unit that divides the span evenly ("2 Tage", "90 Minuten"). */
export function splitSpan(seconds: number): { value: number; unit: SpanUnit } {
  for (const u of [...SPAN_UNITS].reverse()) {
    const v = seconds / u.seconds;
    if (v >= 1 && Math.abs(v - Math.round(v)) < 1e-9) return { value: Math.round(v), unit: u.id };
  }
  return { value: Math.max(1, Math.round(seconds / 60)), unit: "m" };
}

export function formatSpan(seconds: number): string {
  const { value, unit } = splitSpan(seconds);
  const one: Record<SpanUnit, string> = { m: "Minute", h: "Stunde", d: "Tag", w: "Woche", M: "Monat", y: "Jahr" };
  const many: Record<SpanUnit, string> = { m: "Minuten", h: "Stunden", d: "Tage", w: "Wochen", M: "Monate", y: "Jahre" };
  return `${value} ${value === 1 ? one[unit] : many[unit]}`;
}

export interface TimeWindow {
  /** Logical range for the time scale (bar index; whole bars from - 0.5 … to + 0.5). */
  from: number;
  to: number;
  /** Candles inside the window. */
  bars: number;
  /** The window starts before the first loaded candle. */
  clippedStart: boolean;
  /** Fewer than MIN_BARS candles fit, so the view was widened. */
  widened: boolean;
}

/** Fewest candles a window shows; shorter spans than one candle would be an empty chart. */
export const MIN_BARS = 3;

/** First index whose candle starts at or after `time`. */
function firstAtOrAfter(bars: Bar[], time: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Logical range that shows the candles from `fromTime` up to (not including) `toTime`.
 * Works on irregular bars too (tick, range, Renko), since it searches candle times.
 * `rightPad` is empty space after the last candle (only for the newest window).
 */
export function windowForTimes(bars: Bar[], fromTime: number, toTime: number, rightPad = 0): TimeWindow | null {
  const n = bars.length;
  if (!n || !(toTime > fromTime)) return null;
  let a = firstAtOrAfter(bars, fromTime);
  let b = firstAtOrAfter(bars, toTime) - 1;
  const clippedStart = fromTime < bars[0].time;
  if (a > n - 1) a = n - 1;
  if (b < a) b = a;
  let widened = false;
  if (b - a + 1 < MIN_BARS) {
    widened = true;
    b = Math.min(n - 1, Math.max(b, a + MIN_BARS - 1));
    a = Math.max(0, b - MIN_BARS + 1);
  }
  return { from: a - 0.5, to: b + 0.5 + rightPad, bars: b - a + 1, clippedStart, widened };
}

/** The newest `seconds` of history (TradingView's range buttons), with a little room on the right. */
export function windowForSpan(bars: Bar[], seconds: number): TimeWindow | null {
  const n = bars.length;
  if (!n || !(seconds > 0)) return null;
  const step = n > 1 ? bars[n - 1].time - bars[n - 2].time : 60;
  // The window ends where the newest candle closes.
  const end = bars[n - 1].time + Math.max(step, 1);
  const w = windowForTimes(bars, end - seconds, end);
  if (!w) return null;
  // Same share of empty space on the right as the default view (8 of 160 candles).
  const pad = Math.max(2, Math.round(w.bars * 0.05));
  return { ...w, to: w.to + pad };
}

/** Checks a manual price range; the message says what is wrong. */
export function checkPriceRange(min: number, max: number): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "Bitte Zahlen für Min und Max eingeben.";
  if (!(max > min)) return "Max muss größer als Min sein.";
  return null;
}

/** Reads "1.234,5" (German) as well as "1234.5"; NaN when unreadable. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(/\s/g, "");
  if (!t) return NaN;
  // A comma is the decimal separator when present; dots before it are thousands.
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^-?\d*\.?\d+$/.test(normalized) ? Number(normalized) : NaN;
}
