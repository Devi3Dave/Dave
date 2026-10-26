import type { Bar, Series } from "./math";

/**
 * Pine `ta.pivotlow` / `ta.pivothigh`: the value `right` bars back when it is the lowest (highest)
 * of the `left` bars before and `right` bars after it. Equal values on the left are allowed,
 * equal values on the right are not (TradingView behaviour as reproduced by LuxAlgo/PineTS,
 * PR #322 "Fix tie handling in ta.pivothigh/pivotlow"). Returns the index of the pivot found
 * at bar t (t - right), or -1.
 */
export function pivotAt(v: Series, t: number, left: number, right: number, kind: "low" | "high"): number {
  const c = t - right;
  if (c - left < 0) return -1;
  const x = v[c];
  if (x === null) return -1;
  for (let j = c - left; j <= t; j++) {
    const y = v[j];
    if (y === null) return -1;
    if (j === c) continue;
    const beats = kind === "low" ? (j < c ? y < x : y <= x) : j < c ? y > x : y >= x;
    if (beats) return -1;
  }
  return c;
}

export interface DivergenceOptions {
  left: number;
  right: number;
  /** Bars between the two pivots ("Min/Max of Lookback Range"). */
  rangeLower: number;
  rangeUpper: number;
}

export interface Divergence {
  kind: "bull" | "bear" | "hiddenBull" | "hiddenBear";
  /** Pivot indices (earlier, later) on the oscillator and price. */
  from: number;
  to: number;
}

/**
 * Regular and hidden divergences between price and an oscillator, after TradingView's
 * open-source "Divergence Indicator" / "RSI Divergence Indicator" (Pine, MPL 2.0; copy with
 * the default inputs 5/5/60/5 at github.com/fmzquant/strategies, RSI-Divergence-Indicator.md):
 *   plFound = pivotlow(osc, lbL, lbR); inRange = rangeLower ≤ barssince(plFound[1]) ≤ rangeUpper
 *   bull:        low[lbR] < low at the previous pivot and osc[lbR] > osc at the previous pivot
 *   hidden bull: low higher, osc lower; bearish versions on pivothigh with the highs.
 */
export function divergences(bars: Bar[], osc: Series, o: DivergenceOptions): Divergence[] {
  const out: Divergence[] = [];
  let prevLow = -1; // bar t at which the previous pivot low was found
  let prevHigh = -1;
  for (let t = 0; t < bars.length; t++) {
    for (const kind of ["low", "high"] as const) {
      const c = pivotAt(osc, t, o.left, o.right, kind);
      if (c < 0) continue;
      const prev = kind === "low" ? prevLow : prevHigh;
      if (prev >= 0) {
        const bars_ = t - 1 - prev; // barssince(found[1]) on bar t
        const p = prev - o.right;
        const [oc, op] = [osc[c] as number, osc[p] as number];
        if (o.rangeLower <= bars_ && bars_ <= o.rangeUpper) {
          if (kind === "low") {
            if (bars[c].low < bars[p].low && oc > op) out.push({ kind: "bull", from: p, to: c });
            if (bars[c].low > bars[p].low && oc < op) out.push({ kind: "hiddenBull", from: p, to: c });
          } else {
            if (bars[c].high > bars[p].high && oc < op) out.push({ kind: "bear", from: p, to: c });
            if (bars[c].high < bars[p].high && oc > op) out.push({ kind: "hiddenBear", from: p, to: c });
          }
        }
      }
      if (kind === "low") prevLow = t;
      else prevHigh = t;
    }
  }
  return out;
}

/** Oscillator line from pivot to pivot for each divergence of one kind (null elsewhere), for plotting. */
export function divergenceLine(osc: Series, divs: Divergence[], kind: Divergence["kind"]): Series {
  const line: Series = new Array(osc.length).fill(null);
  for (const d of divs) {
    if (d.kind !== kind) continue;
    const [a, b] = [osc[d.from] as number, osc[d.to] as number];
    for (let i = d.from; i <= d.to; i++) line[i] = a + ((b - a) * (i - d.from)) / (d.to - d.from);
  }
  return line;
}
