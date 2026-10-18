// Estimated liquidation heatmap (same idea as CoinGlass' models): every candle opens
// new leveraged positions near its typical price; for common leverage tiers each
// position has a liquidation price. A level stays "alive" until price trades through
// it, which is when those positions would have been liquidated.
import { buyVolume, type Bar } from "./math.js";

export interface LiquidationTier {
  leverage: number;
  weight: number;
}

export const DEFAULT_TIERS: LiquidationTier[] = [
  { leverage: 10, weight: 0.35 },
  { leverage: 25, weight: 0.3 },
  { leverage: 50, weight: 0.2 },
  { leverage: 100, weight: 0.15 },
];

// Maintenance margin rate assumed for the liquidation price (typical for majors).
const MMR = 0.005;

export function liquidationPrice(entry: number, leverage: number, side: "long" | "short"): number {
  return side === "long" ? entry * (1 - 1 / leverage + MMR) : entry * (1 + 1 / leverage - MMR);
}

export interface Heatmap {
  /** Index of the first bar covered. */
  fromIndex: number;
  rows: number;
  priceLow: number;
  priceStep: number;
  /** Column-major intensities: grid[(bar - fromIndex) * rows + row], in quote currency (estimated). */
  grid: Float32Array;
  max: number;
}

export interface LiquidationCluster {
  price: number;
  side: "long" | "short"; // which positions would be liquidated there
  value: number; // estimated notional in quote currency
  distancePct: number;
}

/**
 * Builds the heatmap over the last `lookback` bars. Position size per bar is
 * estimated from its quote volume, split into longs/shorts by taker-buy share.
 */
// The chart asks for the same heatmap twice per update (lines + drawing); cache per bars array.
const cache = new WeakMap<Bar[], Map<string, Heatmap | null>>();

export function liquidationHeatmap(bars: Bar[], lookback: number, rows: number, tiers = DEFAULT_TIERS): Heatmap | null {
  const key = `${lookback}|${rows}|${tiers.map((t) => `${t.leverage}:${t.weight}`).join(",")}`;
  let perBars = cache.get(bars);
  if (!perBars) cache.set(bars, (perBars = new Map()));
  if (!perBars.has(key)) perBars.set(key, computeHeatmap(bars, lookback, rows, tiers));
  return perBars.get(key) ?? null;
}

function computeHeatmap(bars: Bar[], lookback: number, rows: number, tiers: LiquidationTier[]): Heatmap | null {
  const n = bars.length;
  if (n < 2) return null;
  const fromIndex = Math.max(0, n - lookback);
  const win = bars.slice(fromIndex);
  const lo = Math.min(...win.map((b) => b.low));
  const hi = Math.max(...win.map((b) => b.high));
  const minLev = Math.min(...tiers.map((t) => t.leverage));
  // Price band wide enough for the lowest leverage's liquidation prices.
  const priceLow = lo * (1 - 1 / minLev);
  const priceHigh = hi * (1 + 1 / minLev);
  const priceStep = (priceHigh - priceLow) / rows;
  const cols = n - fromIndex;
  const grid = new Float32Array(cols * rows);

  for (let i = fromIndex; i < n; i++) {
    const b = bars[i];
    const entry = (b.high + b.low + b.close) / 3;
    const notional = b.volume * entry;
    if (!(notional > 0)) continue;
    const longShare = b.volume > 0 ? buyVolume(b) / b.volume : 0.5;
    for (const t of tiers) {
      for (const side of ["long", "short"] as const) {
        const price = liquidationPrice(entry, t.leverage, side);
        const row = Math.floor((price - priceLow) / priceStep);
        if (row < 0 || row >= rows) continue;
        const value = notional * t.weight * (side === "long" ? longShare : 1 - longShare);
        // The level lives from the next bar until price trades through it.
        for (let j = i + 1; j < n; j++) {
          const bj = bars[j];
          if (side === "long" ? bj.low <= price : bj.high >= price) break;
          grid[(j - fromIndex) * rows + row] += value;
        }
      }
    }
  }
  let max = 0;
  for (let k = 0; k < grid.length; k++) if (grid[k] > max) max = grid[k];
  return { fromIndex, rows, priceLow, priceStep, grid, max };
}

/** Strongest still-open clusters above (shorts) and below (longs) the last close. */
export function liquidationClusters(bars: Bar[], hm: Heatmap, count = 5): { above: LiquidationCluster[]; below: LiquidationCluster[] } {
  const last = bars[bars.length - 1];
  const col = bars.length - 1 - hm.fromIndex;
  const cells: LiquidationCluster[] = [];
  for (let r = 0; r < hm.rows; r++) {
    const value = hm.grid[col * hm.rows + r];
    if (value <= 0) continue;
    const price = hm.priceLow + (r + 0.5) * hm.priceStep;
    cells.push({ price, side: price < last.close ? "long" : "short", value, distancePct: ((price - last.close) / last.close) * 100 });
  }
  const pick = (side: "long" | "short") =>
    cells
      .filter((c) => c.side === side)
      .sort((a, b) => b.value - a.value)
      .slice(0, count)
      .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
  return { above: pick("short"), below: pick("long") };
}

/** Per bar: price of the strongest open cluster below (longs) and above (shorts) the close. */
export function strongestLevels(bars: Bar[], hm: Heatmap) {
  const below: (number | null)[] = new Array(bars.length).fill(null);
  const above: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = hm.fromIndex + 1; i < bars.length; i++) {
    const col = i - hm.fromIndex;
    let bestBelow = 0;
    let bestAbove = 0;
    for (let r = 0; r < hm.rows; r++) {
      const v = hm.grid[col * hm.rows + r];
      if (v <= 0) continue;
      const price = hm.priceLow + (r + 0.5) * hm.priceStep;
      if (price < bars[i].close && v > bestBelow) {
        bestBelow = v;
        below[i] = price;
      } else if (price > bars[i].close && v > bestAbove) {
        bestAbove = v;
        above[i] = price;
      }
    }
  }
  return { below, above };
}
