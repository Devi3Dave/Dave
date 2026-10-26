/**
 * Chart types that are built from the candles instead of showing them as they are: Renko and Line Break
 * (price-driven: a new brick or line only when the price has moved far enough) and the colors of hollow
 * candles.
 *
 * Sources:
 * - Renko and Line Break: Steve Nison, "Beyond Candlesticks" (1994), chapters on renko and three-line
 *   break charts; the algorithms follow the open-source reference `stocktrends`
 *   (github.com/ChillarAnand/stocktrends, indicators.py: Renko.period_close_bricks, LineBreak).
 * - Hollow candles: mplfinance `hollow_and_filled` (github.com/matplotlib/mplfinance, _utils.py):
 *   the color comes from the previous close (up/down), the body is hollow when close > open.
 */
import { atr, type Bar } from "./math.js";

/** At most this many bricks: a box far too small for the price range is enlarged. */
const MAX_BRICKS = 20_000;

/** Renko on closes: up bricks while the close rises a box above the last brick, a reversal needs two boxes. */
export function renko(bars: Bar[], wanted: number): Bar[] {
  if (!bars.length || !(wanted > 0)) return [];
  let path = 0;
  for (let i = 1; i < bars.length; i++) path += Math.abs(bars[i].close - bars[i - 1].close);
  const box = Math.max(wanted, path / MAX_BRICKS);
  const out: Bar[] = [];
  // The first brick ends on the box grid at or below the first close (stocktrends: close // box * box).
  let last = Math.floor(bars[0].close / box) * box;
  let up = true;
  let lastTime = -Infinity;
  const push = (time: number, open: number, close: number, volume: number) => {
    // Several bricks from one candle: consecutive seconds keep the times unique and ordered.
    lastTime = Math.max(time, lastTime + 1);
    out.push({ time: lastTime, open, close, high: Math.max(open, close), low: Math.min(open, close), volume });
  };
  for (const b of bars) {
    let n = Math.trunc((b.close - last) / box);
    let count = 0;
    const steps: [number, number][] = [];
    if (up && n >= 1) {
      for (; count < n; count++) steps.push([last + count * box, last + (count + 1) * box]);
      last += n * box;
    } else if (up && n <= -2) {
      // Reversal: the first down brick starts at the bottom of the last up brick.
      up = false;
      n += 1;
      last -= box;
      for (; count < -n; count++) steps.push([last - count * box, last - (count + 1) * box]);
      last += n * box;
    } else if (!up && n <= -1) {
      for (; count < -n; count++) steps.push([last - count * box, last - (count + 1) * box]);
      last += n * box;
    } else if (!up && n >= 2) {
      up = true;
      n -= 1;
      last += box;
      for (; count < n; count++) steps.push([last + count * box, last + (count + 1) * box]);
      last += n * box;
    }
    for (const [open, close] of steps) push(b.time, open, close, b.volume / steps.length);
  }
  return out;
}

/**
 * Line Break (Nison's three-line break with `lines` = 3): a new line in the trend direction when the close
 * exceeds the last line; a reversal only when it breaks the extreme of the last `lines` lines, drawn from
 * the start of the last line.
 */
export function lineBreak(bars: Bar[], lines = 3): Bar[] {
  const out: Bar[] = [];
  let up = true;
  let lastTime = -Infinity;
  const push = (time: number, open: number, close: number, volume: number) => {
    lastTime = Math.max(time, lastTime + 1);
    out.push({ time: lastTime, open, close, high: Math.max(open, close), low: Math.min(open, close), volume });
  };
  let pendingVolume = 0;
  for (const b of bars) {
    pendingVolume += b.volume;
    if (!out.length) {
      // The first line is the first candle that moved.
      if (b.close === b.open) continue;
      up = b.close > b.open;
      push(b.time, b.open, b.close, pendingVolume);
      pendingVolume = 0;
      continue;
    }
    const prev = out[out.length - 1];
    const recent = out.slice(-lines);
    if (up ? b.close > prev.close : b.close < prev.close) {
      push(b.time, prev.close, b.close, pendingVolume);
    } else if (up ? b.close < Math.min(...recent.map((l) => l.low)) : b.close > Math.max(...recent.map((l) => l.high))) {
      up = !up;
      push(b.time, prev.open, b.close, pendingVolume);
    } else continue;
    pendingVolume = 0;
  }
  return out;
}

/** Renko box size: fixed, or the ATR (Wilder) of the given length on the last candle, as TradingView's default "ATR". */
export function renkoBoxSize(bars: Bar[], fixed: number, atrLength: number): number {
  if (fixed > 0) return fixed;
  const values = atr(bars, atrLength);
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v > 0) return v;
  }
  return 0;
}

export interface BrickOptions {
  /** Renko box size; 0 = ATR. */
  renkoBox: number;
  renkoAtr: number;
  lineBreakLines: number;
}

/** True for chart types whose candles are built from price moves rather than time. */
export const isPriceDriven = (type: string) => type === "renko" || type === "line_break";

/** The candles a chart type shows (Renko bricks, Line Break lines) or the candles themselves. */
export function displayBars(bars: Bar[], type: string, opts: BrickOptions): Bar[] {
  if (type === "renko") return renko(bars, renkoBoxSize(bars, opts.renkoBox, opts.renkoAtr));
  if (type === "line_break") return lineBreak(bars, Math.max(1, Math.round(opts.lineBreakLines)));
  return bars;
}

/** Hollow candles: color by the previous close, body hollow when close > open. */
export function hollowStyle(bars: Bar[], i: number, up: string, down: string): { color: string; borderColor: string; wickColor: string } {
  const b = bars[i];
  const ref = i > 0 ? bars[i - 1].close : b.open;
  const c = b.close > ref ? up : down;
  return { color: b.close > b.open ? "rgba(0,0,0,0)" : c, borderColor: c, wickColor: c };
}
