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

export interface HeatmapOptions {
  /** First bar to include in the grid; earlier bars only warm the model up. */
  fromIndex?: number;
  rows: number;
  tiers?: LiquidationTier[];
  /** Newly opened position notional per bar (default: quote volume). */
  inflow?: number[];
  /** Share of open positions still open after each bar, e.g. OI(t)/OI(t-1) when OI falls (default: 1). */
  retention?: number[];
  /** Fixed price band (default: the bars' range widened by the lowest leverage). */
  priceLow?: number;
  priceHigh?: number;
}

interface Level {
  price: number;
  row: number;
  side: "long" | "short";
  value: number;
}

/**
 * Forward simulation: each bar opens positions near its typical price for every
 * leverage tier (split long/short by taker-buy share); a level is removed once
 * price trades through it, and shrinks when open interest falls.
 */
export function simulateLiquidations(bars: Bar[], opts: HeatmapOptions): Heatmap | null {
  const n = bars.length;
  if (n < 2) return null;
  const tiers = opts.tiers ?? DEFAULT_TIERS;
  const fromIndex = Math.max(0, Math.min(n - 1, opts.fromIndex ?? 0));
  const rows = opts.rows;
  let priceLow = opts.priceLow;
  let priceHigh = opts.priceHigh;
  if (priceLow === undefined || priceHigh === undefined) {
    const win = bars.slice(fromIndex);
    const minLev = Math.min(...tiers.map((t) => t.leverage));
    priceLow = Math.min(...win.map((b) => b.low)) * (1 - 1 / minLev);
    priceHigh = Math.max(...win.map((b) => b.high)) * (1 + 1 / minLev);
  }
  const priceStep = (priceHigh - priceLow) / rows;
  const grid = new Float32Array((n - fromIndex) * rows);
  let active: Level[] = [];

  for (let j = 0; j < n; j++) {
    const b = bars[j];
    // 1. Positions closed (OI fell) and liquidations hit by this bar.
    const keep = opts.retention?.[j] ?? 1;
    active = active.filter((l) => {
      l.value *= keep;
      return l.side === "long" ? b.low > l.price : b.high < l.price;
    });
    // 2. What is still open at this bar.
    if (j >= fromIndex) {
      const base = (j - fromIndex) * rows;
      for (const l of active) if (l.row >= 0 && l.row < rows) grid[base + l.row] += l.value;
    }
    // 3. New positions opened during this bar (alive from the next bar on).
    const entry = (b.high + b.low + b.close) / 3;
    const notional = opts.inflow ? opts.inflow[j] : b.volume * entry;
    if (!(notional > 0)) continue;
    const longShare = b.volume > 0 ? buyVolume(b) / b.volume : 0.5;
    for (const t of tiers) {
      for (const side of ["long", "short"] as const) {
        const price = liquidationPrice(entry, t.leverage, side);
        active.push({
          price,
          row: Math.floor((price - priceLow) / priceStep),
          side,
          value: notional * t.weight * (side === "long" ? longShare : 1 - longShare),
        });
      }
    }
  }
  let max = 0;
  for (let k = 0; k < grid.length; k++) if (grid[k] > max) max = grid[k];
  return { fromIndex, rows, priceLow, priceStep, grid, max };
}

// The chart asks for the same heatmap twice per update (lines + drawing); cache per bars array.
const cache = new WeakMap<Bar[], Map<string, Heatmap | null>>();

/** Volume-based heatmap over the last `lookback` bars (used by the chart indicator). */
export function liquidationHeatmap(bars: Bar[], lookback: number, rows: number, tiers = DEFAULT_TIERS): Heatmap | null {
  const key = `${lookback}|${rows}|${tiers.map((t) => `${t.leverage}:${t.weight}`).join(",")}`;
  let perBars = cache.get(bars);
  if (!perBars) cache.set(bars, (perBars = new Map()));
  if (!perBars.has(key)) perBars.set(key, simulateLiquidations(bars, { fromIndex: bars.length - lookback, rows, tiers }));
  return perBars.get(key) ?? null;
}

export interface OiPoint {
  time: number;
  value: number;
}

/**
 * Turns an open-interest history into per-bar inflow (OI increases) and retention
 * (OI decreases). Bars without OI data fall back to quote volume scaled to the same
 * order of magnitude (median ratio over the bars that have both).
 */
export function openInterestModel(bars: Bar[], oi: OiPoint[]): { inflow: number[]; retention: number[]; coverage: number } {
  const n = bars.length;
  const oiAt: (number | null)[] = new Array(n).fill(null);
  const step = n > 1 ? bars[n - 1].time - bars[n - 2].time : 3600;
  // Each OI snapshot goes to the bar whose open time is closest (within half a bar).
  const index = new Map(bars.map((b, i) => [Math.round(b.time / step), i]));
  for (const p of oi) {
    const i = index.get(Math.round(p.time / step));
    if (i !== undefined && Math.abs(bars[i].time - p.time) <= step / 2) oiAt[i] = p.value;
  }
  const volNotional = bars.map((b) => b.volume * ((b.high + b.low + b.close) / 3));
  const inflow: number[] = new Array(n).fill(0);
  const retention: number[] = new Array(n).fill(1);
  const ratios: number[] = [];
  let covered = 0;
  for (let i = 1; i < n; i++) {
    const a = oiAt[i - 1];
    const b = oiAt[i];
    if (a === null || b === null) continue;
    covered++;
    const d = b - a;
    if (d > 0) {
      inflow[i] = d;
      if (volNotional[i] > 0) ratios.push(d / volNotional[i]);
    } else if (a > 0) {
      retention[i] = b / a;
    }
  }
  ratios.sort((x, y) => x - y);
  const scale = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0.1;
  for (let i = 0; i < n; i++) {
    if (oiAt[i] === null || (i > 0 && oiAt[i - 1] === null)) inflow[i] = volNotional[i] * scale;
  }
  return { inflow, retention, coverage: n > 1 ? covered / (n - 1) : 0 };
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
