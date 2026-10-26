import type { Bar } from "./math";
import { barSeconds, tfLabel, type OrderBlock } from "./orderblocks";

/**
 * Fair Value Gaps (FVG, "imbalance"), three-candle definition as in
 * smart-money-concepts `smc.fvg` (github.com/joshyattridge/smart-money-concepts,
 * smartmoneyconcepts/smc.py) and the "Fair Value Gap [LuxAlgo]" script on TradingView:
 * - bullish: high of candle 1 < low of candle 3 and candle 2 closes up → zone high₁ … low₃
 * - bearish: low of candle 1 > high of candle 3 and candle 2 closes down → zone high₃ … low₁
 * A gap counts as mitigated once price trades back into it (smc: bullish low ≤ top,
 * bearish high ≥ bottom); "half" and "full" wait for the midpoint or the far edge instead.
 */
export type FvgMitigation = "touch" | "half" | "full";

export interface FvgOptions {
  /** Minimum gap size in percent of price (LuxAlgo "Threshold %"), 0 = every gap. */
  minPct: number;
  mitigation: FvgMitigation;
  /** Most recent zones per side and state that are returned. */
  maxZones: number;
  showMitigated: boolean;
}

export function fairValueGaps(bars: Bar[], opts: FvgOptions): OrderBlock[] {
  if (bars.length < 3) return [];
  const step = barSeconds(bars);
  const tf = tfLabel(step);
  const found: OrderBlock[] = [];
  for (let i = 2; i < bars.length; i++) {
    const [a, mid, c] = [bars[i - 2], bars[i - 1], bars[i]];
    let side: "bull" | "bear" | null = null;
    let top = 0;
    let bottom = 0;
    if (a.high < c.low && mid.close > mid.open) [side, top, bottom] = ["bull", c.low, a.high];
    else if (a.low > c.high && mid.close < mid.open) [side, top, bottom] = ["bear", a.low, c.high];
    if (!side || ((top - bottom) / bottom) * 100 < opts.minPct) continue;
    found.push({ tf, tfSeconds: step, side, top, bottom, from: a.time, activeIndex: i + 1, end: null, label: `FVG ${tf}` });
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

export const FVG_MITIGATION: FvgMitigation[] = ["touch", "half", "full"];
