/**
 * Footprint chart: each candle split into price rows with the volume bought and sold in them, the POC
 * (row with the most volume) and the delta (bought − sold), as TradingView's "Volume Footprint" chart type.
 *
 * TradingView builds it from tick data. Here it is built from candles of a lower time frame (1s–5m):
 * Binance klines carry the taker-buy volume ("Taker buy base asset volume", Binance Spot API, GET
 * /api/v3/klines), so every lower candle splits into bought and sold volume, which is spread evenly over
 * the price rows its range covers (the method of the volume profile). The finer the lower time frame, the
 * closer it comes to the tick footprint.
 */
import { buyVolume, type Bar } from "./math.js";
import { subBarsOf } from "./replay.js";

export interface FootprintRow {
  /** Lower edge of the row. */
  price: number;
  buy: number;
  sell: number;
}

export interface FootprintBar {
  time: number;
  /** Rows from low to high, all `rowSize` apart. */
  rows: FootprintRow[];
  rowSize: number;
  /** Lower edge of the row with the most volume. */
  poc: number;
  /** Bought minus sold volume of the candle. */
  delta: number;
  volume: number;
}

/** A round row height (1, 2 or 5 × 10^n) giving about `target` rows for a typical candle. */
export function footprintRowSize(bars: Bar[], target = 12): number {
  const ranges = bars
    .slice(-200)
    .map((b) => b.high - b.low)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  if (!ranges.length) return 0;
  const raw = ranges[Math.floor(ranges.length / 2)] / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((m) => m * pow >= raw)! * pow;
  // Rounding noise of the floating point steps (0.1 + 0.2 …) would split rows.
  return Number(step.toPrecision(6));
}

/** Footprints of the chart candles that the lower-time-frame candles cover. */
export function buildFootprints(bars: Bar[], sub: Bar[], rowSize: number): FootprintBar[] {
  if (!(rowSize > 0) || !sub.length || !bars.length) return [];
  // Nothing after the last candle's end shows through (bar replay hides later candles).
  const n = bars.length;
  const end = n > 1 ? bars[n - 1].time + (bars[n - 1].time - bars[n - 2].time) : Infinity;
  if (sub[sub.length - 1].time >= end) sub = sub.filter((p) => p.time < end);
  if (!sub.length) return [];
  const out: FootprintBar[] = [];
  const firstSub = sub[0].time;
  for (let i = 0; i < bars.length; i++) {
    // Only candles the lower time frame covers from their start.
    if (bars[i].time < firstSub) continue;
    const parts = subBarsOf(sub, bars, i);
    if (!parts.length) continue;
    const rows = new Map<number, FootprintRow>();
    let delta = 0;
    let volume = 0;
    for (const p of parts) {
      const buy = Math.min(p.volume, Math.max(0, buyVolume(p)));
      const sell = p.volume - buy;
      delta += buy - sell;
      volume += p.volume;
      const lo = Math.floor(p.low / rowSize + 1e-9);
      const hi = Math.max(lo, Math.ceil(p.high / rowSize - 1e-9) - 1);
      const n = hi - lo + 1;
      for (let r = lo; r <= hi; r++) {
        const row = rows.get(r) ?? { price: Number((r * rowSize).toPrecision(12)), buy: 0, sell: 0 };
        row.buy += buy / n;
        row.sell += sell / n;
        rows.set(r, row);
      }
    }
    const list = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    let poc = list[0];
    for (const row of list) if (row.buy + row.sell > poc.buy + poc.sell) poc = row;
    out.push({ time: bars[i].time, rows: list, rowSize, poc: poc.price, delta, volume });
  }
  return out;
}

/** The lower time frame a footprint of `intervalSec` candles is built from: about 15–60 parts per candle, at least 1 s. */
export function footprintInterval(intervalSec: number): string | null {
  if (intervalSec <= 60) return intervalSec > 1 ? "1s" : null;
  if (intervalSec <= 900) return "1m";
  if (intervalSec <= 3600) return "1m";
  if (intervalSec <= 4 * 3600) return "5m";
  return "15m";
}
