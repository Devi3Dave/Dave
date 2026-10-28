import type { Bar } from "./math";
import { barSeconds, resample, tfLabel, type OrderBlock } from "./orderblocks";

/**
 * "FVG (Nephew_Sam_)" style fair value gaps. The original TradingView script
 * (tradingview.com/script/G8b8t2er-FVG-Nephew-Sam) is protected, so this is an open approximation
 * built from its public description and release notes only:
 * - inputs "Line length", "Delete lines" (remove a gap once filled), fill by candle close or wick,
 *   bull/bear colors; release notes add multi-timeframe gaps, "wait for candle close" and hiding labels.
 * Gap detection is the plain three-candle definition (high of candle 1 < low of candle 3 = bullish,
 * low of candle 1 > high of candle 3 = bearish), without the middle-candle or size filters of our
 * own FVG indicator (shared/fvg.ts), since the description names none. "Filled" means price reached
 * the far edge of the gap (bullish: bottom, bearish: top), by wick (low/high) or by close.
 */
export interface NephewFvgOptions {
  /** Box length in chart candles from the first candle, 0 = extend to the right edge. */
  length: number;
  /** Remove gaps once filled (otherwise they stay greyed out). */
  deleteFilled: boolean;
  fillBy: "wick" | "close";
  /** Show the gaps of the chart time frame. */
  chartTf: boolean;
  /** Extra time frames in seconds (≤ chart interval = ignored). */
  higher: number[];
  /** Higher time frames only use completed candles; off = the forming candle counts too (may repaint). */
  waitClose: boolean;
  labels: boolean;
  /** Most recent gaps kept per time frame, side and state (default 30, so the chart stays readable). */
  maxZones?: number;
}

export function nephewFvgs(bars: Bar[], opts: NephewFvgOptions): OrderBlock[] {
  if (bars.length < 3) return [];
  const step = barSeconds(bars);
  const frames = [...(opts.chartTf ? [step] : []), ...opts.higher.filter((s) => s > step).sort((a, b) => a - b)].filter((s, i, a) => a.indexOf(s) === i);
  return frames.flatMap((seconds) => {
    const src = seconds === step ? bars.map((b, i) => ({ ...b, last: i })) : resample(bars, seconds, !opts.waitClose);
    return gapsOf(src, bars, seconds, opts);
  });
}

function gapsOf(src: (Bar & { last: number })[], bars: Bar[], seconds: number, opts: NephewFvgOptions): OrderBlock[] {
  const tf = tfLabel(seconds);
  const found: OrderBlock[] = [];
  for (let i = 2; i < src.length; i++) {
    const [a, c] = [src[i - 2], src[i]];
    let side: "bull" | "bear" | null = null;
    let top = 0;
    let bottom = 0;
    if (a.high < c.low) [side, top, bottom] = ["bull", c.low, a.high];
    else if (a.low > c.high) [side, top, bottom] = ["bear", a.low, c.high];
    if (!side) continue;
    const z: OrderBlock = { tf, tfSeconds: seconds, side, top, bottom, from: a.time, activeIndex: c.last + 1, end: null, label: opts.labels ? `FVG ${tf}` : "" };
    if (opts.length > 0) {
      const first = bars.findIndex((b) => b.time >= a.time);
      const stop = first + opts.length;
      if (first >= 0 && stop < bars.length) z.until = bars[stop].time;
    }
    found.push(z);
  }
  for (const z of found) {
    for (let i = z.activeIndex; i < bars.length; i++) {
      const b = bars[i];
      const price = opts.fillBy === "close" ? b.close : z.side === "bull" ? b.low : b.high;
      if (z.side === "bull" ? price <= z.bottom : price >= z.top) {
        z.end = b.time;
        break;
      }
    }
  }
  const pick = (side: "bull" | "bear", open: boolean) => found.filter((z) => z.side === side && (z.end === null) === open).slice(-(opts.maxZones ?? 30));
  const filled = opts.deleteFilled ? [] : [...pick("bull", false), ...pick("bear", false)];
  return [...filled, ...pick("bull", true), ...pick("bear", true)];
}

/** +1 / -1 on the chart candle that completes a new bullish / bearish gap (of any shown time frame), else 0 (alert source). */
export function nephewFvgEvents(bars: Bar[], opts: NephewFvgOptions): number[] {
  const out = new Array<number>(bars.length).fill(0);
  for (const z of nephewFvgs(bars, { ...opts, deleteFilled: false, maxZones: Number.MAX_SAFE_INTEGER })) {
    const i = z.activeIndex - 1;
    if (i >= 0 && i < bars.length) out[i] = z.side === "bull" ? 1 : -1;
  }
  return out;
}
