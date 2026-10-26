/**
 * Symbol comparison: other symbols drawn as lines over the chart. As in TradingView's "Compare symbol", the
 * price scale then shows percent change from the first visible candle, each line measured from its own
 * first visible value (lightweight-charts PriceScaleMode.Percentage, see
 * tradingview.github.io/lightweight-charts/docs/api/enums/PriceScaleMode).
 */
import type { Bar } from "./math.js";

export const MAX_COMPARE = 5;
export const COMPARE_COLORS = ["#ff9800", "#ab47bc", "#26c6da", "#ec407a", "#9ccc65"];

/** The closes of a compared symbol within the time range of the chart's candles. */
export function alignCompare(main: Bar[], other: Bar[]): { time: number; value: number }[] {
  if (!main.length) return [];
  const from = main[0].time;
  const to = main[main.length - 1].time;
  return other.filter((b) => b.time >= from && b.time <= to && Number.isFinite(b.close)).map((b) => ({ time: b.time, value: b.close }));
}

/** The close of a compared symbol at a candle time, or the last close before it (markets with other hours). */
export function compareCloseAt(other: Bar[], time: number): number | null {
  let lo = 0;
  let hi = other.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (other[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? null : other[found].close;
}

/** Adds a symbol to the comparison list: upper case, no duplicates, not the chart's own symbol, at most MAX_COMPARE. */
export function withCompare(list: string[], symbol: string, own: string): string[] {
  const s = symbol.trim().toUpperCase();
  if (!s || s === own || list.includes(s) || list.length >= MAX_COMPARE) return list;
  return [...list, s];
}
