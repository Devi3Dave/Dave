import type { Bar } from "./math";
import { barSeconds, resample, tfLabel, type OrderBlock } from "./orderblocks";

/**
 * Fair Value Gaps (FVG, "imbalance"), three-candle definition as in
 * smart-money-concepts `smc.fvg` (github.com/joshyattridge/smart-money-concepts,
 * smartmoneyconcepts/smc.py) and the "Fair Value Gap [LuxAlgo]" script on TradingView:
 * - bullish: high of candle 1 < low of candle 3 and candle 2 closes up → zone high₁ … low₃
 * - bearish: low of candle 1 > high of candle 3 and candle 2 closes down → zone high₃ … low₁
 * A gap counts as mitigated once price trades back into it (smc: bullish low ≤ top,
 * bearish high ≥ bottom); "half" and "full" wait for the midpoint or the far edge instead.
 * `higher` adds the gaps of higher time frames (completed candles resampled from the chart bars, like the
 * "Timeframe" input of Fair Value Gap [LuxAlgo]), e.g. the 15m gaps on a 1m chart.
 * `ce` adds the 50 % line, ICT's "consequential encroachment" (midpoint of the gap).
 */
export type FvgMitigation = "touch" | "half" | "full";

export interface FvgOptions {
  /** Minimum gap size in percent of price (LuxAlgo "Threshold %"), 0 = every gap. */
  minPct: number;
  mitigation: FvgMitigation;
  /** Most recent zones per side and state that are returned. */
  maxZones: number;
  showMitigated: boolean;
  ce?: boolean;
  /** Extra time frames in seconds (≤ chart interval = ignored). */
  higher?: number[];
}

export function fairValueGaps(bars: Bar[], opts: FvgOptions): OrderBlock[] {
  if (bars.length < 3) return [];
  const step = barSeconds(bars);
  const frames = [step, ...(opts.higher ?? []).filter((s) => s > step).sort((a, b) => a - b)].filter((s, i, a) => a.indexOf(s) === i);
  return frames.flatMap((seconds) => {
    const src = seconds === step ? bars.map((b, i) => ({ ...b, last: i })) : resample(bars, seconds);
    return gapsOf(src, bars, tfLabel(seconds), seconds, opts);
  });
}

function gapsOf(src: (Bar & { last: number })[], bars: Bar[], tf: string, tfSeconds: number, opts: FvgOptions): OrderBlock[] {
  const found: OrderBlock[] = [];
  for (let i = 2; i < src.length; i++) {
    const [a, mid, c] = [src[i - 2], src[i - 1], src[i]];
    let side: "bull" | "bear" | null = null;
    let top = 0;
    let bottom = 0;
    if (a.high < c.low && mid.close > mid.open) [side, top, bottom] = ["bull", c.low, a.high];
    else if (a.low > c.high && mid.close < mid.open) [side, top, bottom] = ["bear", a.low, c.high];
    if (!side || ((top - bottom) / bottom) * 100 < opts.minPct) continue;
    // Counts from the first chart candle after the third candle has closed.
    found.push({ tf, tfSeconds, side, top, bottom, from: a.time, activeIndex: c.last + 1, end: null, label: `FVG ${tf}`, ...(opts.ce ? { mid: true } : {}) });
  }
  for (const z of found) {
    const level =
      opts.mitigation === "touch" ? (z.side === "bull" ? z.top : z.bottom) : opts.mitigation === "half" ? (z.top + z.bottom) / 2 : z.side === "bull" ? z.bottom : z.top;
    for (let i = z.activeIndex; i < bars.length; i++) {
      if (z.side === "bull" ? bars[i].low <= level : bars[i].high >= level) {
        z.end = bars[i].time;
        break;
      }
    }
  }
  const pick = (side: "bull" | "bear", open: boolean) => found.filter((z) => z.side === side && (z.end === null) === open).slice(-opts.maxZones);
  const mitigated = opts.showMitigated ? [...pick("bull", false), ...pick("bear", false)] : [];
  return [...mitigated, ...pick("bull", true), ...pick("bear", true)];
}

/** +1 / -1 on the chart candle that completes a new bullish / bearish gap (of any time frame), else 0 (alert source). */
export function fvgEvents(bars: Bar[], opts: FvgOptions): number[] {
  const out = new Array<number>(bars.length).fill(0);
  for (const z of fairValueGaps(bars, { ...opts, maxZones: Number.MAX_SAFE_INTEGER, showMitigated: true })) {
    const i = z.activeIndex - 1;
    if (i >= 0 && i < bars.length) out[i] = z.side === "bull" ? 1 : -1;
  }
  return out;
}

export const FVG_MITIGATION: FvgMitigation[] = ["touch", "half", "full"];
