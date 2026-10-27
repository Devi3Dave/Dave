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
 * - Kagi: Steve Nison, "Beyond Candlesticks" (1994), chapter "Kagi charts": the line follows the close,
 *   turns only after the reversal amount, becomes thick (yang) above the previous shoulder and thin (yin)
 *   below the previous waist.
 * - Point & Figure: Jeremy du Plessis, "The Definitive Guide to Point and Figure" (2005), chapters 2–3,
 *   and Thomas Dorsey, "Point and Figure Charting" (3rd ed., 2007): boxes on a fixed grid, a column only
 *   grows by whole boxes, a reversal needs `reversal` boxes (3 by default) and starts one box from the
 *   extreme; with high/low, the extension in the column's direction is checked before the reversal.
 * - Range bars: Vicente Nicolellis (1995) as described by TradeStation ("Range Bar Chart",
 *   help.tradestation.com/10_00/eng/tradestationhelp/charting/rangebar_chart.htm) and TradingView
 *   ("Understanding range charts", support 43000474007): every bar spans the same high–low range and a new
 *   bar starts when the price leaves it. Without ticks the path inside a candle is open → low → high →
 *   close for rising and open → high → low → close for falling candles (the usual OHLC path assumption).
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

/** A Kagi line: from `open` to `close`; `thick` at its start, switching at `switchAt` (yang ↔ yin) if set. */
export interface KagiLine extends Bar {
  thick: boolean;
  switchAt: number | null;
}

/**
 * Kagi on closes. The first line starts at the first close and is drawn once the price has moved the
 * reversal amount; a line extends while the close goes further and turns once it comes back the reversal
 * amount from the line's end (the turn is the shoulder at a top and the waist at a bottom).
 */
export function kagi(bars: Bar[], reversal: number): KagiLine[] {
  if (!bars.length || !(reversal > 0)) return [];
  const out: KagiLine[] = [];
  let lastTime = -Infinity;
  const start = bars[0].close;
  let shoulder = Infinity;
  let waist = -Infinity;
  let volume = 0;
  for (const b of bars) {
    volume += b.volume;
    const p = b.close;
    const cur = out[out.length - 1];
    if (!cur) {
      if (Math.abs(p - start) < reversal) continue;
      lastTime = b.time;
      out.push({ time: b.time, open: start, close: p, high: Math.max(start, p), low: Math.min(start, p), volume, thick: p > start, switchAt: null });
      volume = 0;
      continue;
    }
    const up = cur.close > cur.open;
    const end = up ? cur.high : cur.low;
    if (up ? p > end : p < end) {
      cur.close = p;
      cur.high = Math.max(cur.high, p);
      cur.low = Math.min(cur.low, p);
      cur.volume += volume;
    } else if (up ? p <= end - reversal : p >= end + reversal) {
      if (up) shoulder = end;
      else waist = end;
      const thick = cur.switchAt === null ? cur.thick : !cur.thick;
      lastTime = Math.max(b.time, lastTime + 1);
      out.push({ time: lastTime, open: end, close: p, high: Math.max(end, p), low: Math.min(end, p), volume, thick, switchAt: null });
    } else continue;
    volume = 0;
    // Yang above the previous shoulder, yin below the previous waist; the switch is drawn at that price.
    const line = out[out.length - 1];
    const rising = line.close > line.open;
    const level = rising ? shoulder : waist;
    if (line.switchAt === null && line.thick !== rising && (rising ? line.close > level : line.close < level)) {
      if (rising ? level > line.open : level < line.open) line.switchAt = level;
      else line.thick = rising;
    }
  }
  return out;
}

/** A Point & Figure column: X (rising, open = bottom box, close = top box) or O (falling, open = top box). */
export interface PnfColumn extends Bar {
  box: number;
}

export type PnfSource = "hl" | "close";

/**
 * Point & Figure. Boxes are price levels on the grid k·box; an X column fills every level the high
 * reached, an O column every level the low reached. A reversal needs the price `reversal` boxes away from
 * the column's last box and starts one box from it.
 */
export function pointFigure(bars: Bar[], wanted: number, reversal = 3, source: PnfSource = "hl"): PnfColumn[] {
  if (!bars.length || !(wanted > 0)) return [];
  const min = Math.min(...bars.map((b) => (source === "hl" ? b.low : b.close)));
  const max = Math.max(...bars.map((b) => (source === "hl" ? b.high : b.close)));
  // Bounded like Renko: never more than MAX_BRICKS boxes across the whole range.
  const box = Math.max(wanted, (max - min) / MAX_BRICKS);
  const r = Math.max(1, Math.round(reversal));
  // Rounding guards against 0.1 + 0.2 style errors on the grid.
  const eps = box * 1e-9;
  const up = (p: number) => Math.floor((p + eps) / box) * box;
  const down = (p: number) => Math.ceil((p - eps) / box) * box;
  const out: PnfColumn[] = [];
  let lastTime = -Infinity;
  const anchor = up(bars[0].close);
  let volume = 0;
  const push = (time: number, open: number, close: number) => {
    lastTime = Math.max(time, lastTime + 1);
    out.push({ time: lastTime, open, close, high: Math.max(open, close), low: Math.min(open, close), volume, box });
    volume = 0;
  };
  for (const b of bars) {
    volume += b.volume;
    const hi = source === "hl" ? b.high : b.close;
    const lo = source === "hl" ? b.low : b.close;
    const col = out[out.length - 1];
    if (!col) {
      const top = up(hi);
      const bottom = down(lo);
      const rise = top - anchor;
      const fall = anchor - bottom;
      if (rise >= box - eps && rise >= fall) push(b.time, anchor, top);
      else if (fall >= box - eps) push(b.time, anchor, bottom);
      continue;
    }
    const isX = col.close > col.open;
    if (isX) {
      const top = up(hi);
      if (top > col.close + eps) {
        col.close = col.high = top;
        col.volume += volume;
        volume = 0;
      } else if (down(lo) <= col.close - r * box + eps) push(b.time, col.close - box, down(lo));
    } else {
      const bottom = down(lo);
      if (bottom < col.close - eps) {
        col.close = col.low = bottom;
        col.volume += volume;
        volume = 0;
      } else if (up(hi) >= col.close + r * box - eps) push(b.time, col.close + box, up(hi));
    }
  }
  return out;
}

/** Range bars: each bar spans `range` from low to high; the next bar opens where the last one closed. */
export function rangeBars(bars: Bar[], wanted: number): Bar[] {
  if (!bars.length || !(wanted > 0)) return [];
  let travel = 0;
  for (const b of bars) travel += 2 * (b.high - b.low);
  const range = Math.max(wanted, travel / MAX_BRICKS);
  const out: Bar[] = [];
  let lastTime = -Infinity;
  const open = (time: number, price: number): Bar => {
    lastTime = Math.max(time, lastTime + 1);
    const bar = { time: lastTime, open: price, high: price, low: price, close: price, volume: 0 };
    out.push(bar);
    return bar;
  };
  let c: Bar | null = null;
  for (const b of bars) {
    if (!c) c = open(b.time, b.open);
    const path = b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
    const before = out.length;
    for (const p of path) {
      for (;;) {
        if (p > c.low + range) {
          c.high = c.close = c.low + range;
          c = open(b.time, c.close);
        } else if (p < c.high - range) {
          c.low = c.close = c.high - range;
          c = open(b.time, c.close);
        } else {
          c.high = Math.max(c.high, p);
          c.low = Math.min(c.low, p);
          c.close = p;
          break;
        }
      }
    }
    // The candle's volume goes to the bars it touched.
    const touched = out.slice(before - 1);
    for (const t of touched) t.volume += b.volume / touched.length;
  }
  return out;
}

export interface BrickOptions {
  /** Renko box size; 0 = ATR. */
  renkoBox: number;
  /** ATR length for every size set to ATR (Renko, Kagi, Point & Figure, Range). */
  renkoAtr: number;
  lineBreakLines: number;
  /** Kagi reversal amount; 0 = ATR. */
  kagiReversal: number;
  /** Point & Figure box size; 0 = ATR. */
  pnfBox: number;
  pnfReversal: number;
  pnfSource: PnfSource;
  /** Range bar size; 0 = ATR. */
  rangeSize: number;
}

const PRICE_DRIVEN = new Set(["renko", "line_break", "kagi", "point_figure", "range"]);

/** True for chart types whose candles are built from price moves rather than time. */
export const isPriceDriven = (type: string) => PRICE_DRIVEN.has(type);

/** Changes whenever the price-driven candles of a chart type would change with the options. */
export function brickKey(type: string, o: BrickOptions): string {
  if (!isPriceDriven(type)) return "";
  return [type, o.renkoBox, o.renkoAtr, o.lineBreakLines, o.kagiReversal, o.pnfBox, o.pnfReversal, o.pnfSource, o.rangeSize].join("|");
}

/** The candles a chart type shows (Renko bricks, Line Break lines, Kagi lines, P&F columns, range bars) or the candles themselves. */
export function displayBars(bars: Bar[], type: string, opts: BrickOptions): Bar[] {
  const size = (fixed: number) => renkoBoxSize(bars, fixed, opts.renkoAtr);
  if (type === "renko") return renko(bars, size(opts.renkoBox));
  if (type === "line_break") return lineBreak(bars, Math.max(1, Math.round(opts.lineBreakLines)));
  if (type === "kagi") return kagi(bars, size(opts.kagiReversal));
  if (type === "point_figure") return pointFigure(bars, size(opts.pnfBox), opts.pnfReversal, opts.pnfSource);
  if (type === "range") return rangeBars(bars, size(opts.rangeSize));
  return bars;
}

/** Hollow candles: color by the previous close, body hollow when close > open. */
export function hollowStyle(bars: Bar[], i: number, up: string, down: string): { color: string; borderColor: string; wickColor: string } {
  const b = bars[i];
  const ref = i > 0 ? bars[i - 1].close : b.open;
  const c = b.close > ref ? up : down;
  return { color: b.close > b.open ? "rgba(0,0,0,0)" : c, borderColor: c, wickColor: c };
}
