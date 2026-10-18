import type { Bar } from "./math";

export type Direction = "bullish" | "bearish" | "neutral";

export interface CandlePattern {
  index: number;
  time: number;
  id: string;
  name: string;
  direction: Direction;
  /** Number of candles the pattern spans (ending at `index`). */
  bars: number;
}

interface CandleDef {
  id: string;
  name: string;
  direction: Direction;
  bars: number;
  test: (c: Ctx) => boolean;
}

interface Ctx {
  bars: Bar[];
  i: number;
  avgBody: number;
  /** Close fell (true) / rose (false) over the 5 candles before the pattern. */
  down: boolean;
  up: boolean;
}

const body = (b: Bar) => Math.abs(b.close - b.open);
const range = (b: Bar) => b.high - b.low;
const upperWick = (b: Bar) => b.high - Math.max(b.open, b.close);
const lowerWick = (b: Bar) => Math.min(b.open, b.close) - b.low;
const green = (b: Bar) => b.close > b.open;
const red = (b: Bar) => b.close < b.open;
const mid = (b: Bar) => (b.open + b.close) / 2;

const hammerShape = (b: Bar, avgBody: number) => range(b) > avgBody && body(b) > 0 && lowerWick(b) >= 2 * body(b) && upperWick(b) <= Math.max(body(b) * 0.5, range(b) * 0.1);
const invertedShape = (b: Bar, avgBody: number) => range(b) > avgBody && body(b) > 0 && upperWick(b) >= 2 * body(b) && lowerWick(b) <= Math.max(body(b) * 0.5, range(b) * 0.1);

/** Ordered by priority: when several match on one candle, the first (longest) one wins. */
const CANDLES: CandleDef[] = [
  {
    id: "three_white_soldiers",
    name: "Three White Soldiers",
    direction: "bullish",
    bars: 3,
    test: ({ bars, i, avgBody }) => {
      const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
      return [a, b, c].every((x) => green(x) && body(x) > 0.6 * avgBody && upperWick(x) < body(x) * 0.5) && b.close > a.close && c.close > b.close && b.open > a.open && b.open < a.close && c.open > b.open && c.open < b.close;
    },
  },
  {
    id: "three_black_crows",
    name: "Three Black Crows",
    direction: "bearish",
    bars: 3,
    test: ({ bars, i, avgBody }) => {
      const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
      return [a, b, c].every((x) => red(x) && body(x) > 0.6 * avgBody && lowerWick(x) < body(x) * 0.5) && b.close < a.close && c.close < b.close && b.open < a.open && b.open > a.close && c.open < b.open && c.open > b.close;
    },
  },
  {
    id: "morning_star",
    name: "Morning Star",
    direction: "bullish",
    bars: 3,
    test: ({ bars, i, avgBody, down }) => {
      const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
      return down && red(a) && body(a) > avgBody && body(b) < 0.35 * body(a) && Math.max(b.open, b.close) <= a.close + body(a) * 0.1 && green(c) && c.close > mid(a);
    },
  },
  {
    id: "evening_star",
    name: "Evening Star",
    direction: "bearish",
    bars: 3,
    test: ({ bars, i, avgBody, up }) => {
      const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
      return up && green(a) && body(a) > avgBody && body(b) < 0.35 * body(a) && Math.min(b.open, b.close) >= a.close - body(a) * 0.1 && red(c) && c.close < mid(a);
    },
  },
  {
    id: "bullish_engulfing",
    name: "Bullish Engulfing",
    direction: "bullish",
    bars: 2,
    test: ({ bars, i, avgBody, down }) => {
      const [a, b] = [bars[i - 1], bars[i]];
      return down && red(a) && green(b) && b.open <= a.close && b.close >= a.open && body(b) > body(a) && body(b) > 0.8 * avgBody;
    },
  },
  {
    id: "bearish_engulfing",
    name: "Bearish Engulfing",
    direction: "bearish",
    bars: 2,
    test: ({ bars, i, avgBody, up }) => {
      const [a, b] = [bars[i - 1], bars[i]];
      return up && green(a) && red(b) && b.open >= a.close && b.close <= a.open && body(b) > body(a) && body(b) > 0.8 * avgBody;
    },
  },
  {
    id: "piercing_line",
    name: "Piercing Line",
    direction: "bullish",
    bars: 2,
    test: ({ bars, i, avgBody, down }) => {
      const [a, b] = [bars[i - 1], bars[i]];
      return down && red(a) && body(a) > avgBody && green(b) && b.open <= a.close && b.close > mid(a) && b.close < a.open;
    },
  },
  {
    id: "dark_cloud_cover",
    name: "Dark Cloud Cover",
    direction: "bearish",
    bars: 2,
    test: ({ bars, i, avgBody, up }) => {
      const [a, b] = [bars[i - 1], bars[i]];
      return up && green(a) && body(a) > avgBody && red(b) && b.open >= a.close && b.close < mid(a) && b.close > a.open;
    },
  },
  {
    id: "bullish_harami",
    name: "Bullish Harami",
    direction: "bullish",
    bars: 2,
    test: ({ bars, i, avgBody, down }) => {
      const [a, b] = [bars[i - 1], bars[i]];
      return down && red(a) && body(a) > avgBody && green(b) && b.open > a.close && b.close < a.open && body(b) < 0.6 * body(a);
    },
  },
  {
    id: "bearish_harami",
    name: "Bearish Harami",
    direction: "bearish",
    bars: 2,
    test: ({ bars, i, avgBody, up }) => {
      const [a, b] = [bars[i - 1], bars[i]];
      return up && green(a) && body(a) > avgBody && red(b) && b.open < a.close && b.close > a.open && body(b) < 0.6 * body(a);
    },
  },
  { id: "hammer", name: "Hammer", direction: "bullish", bars: 1, test: ({ bars, i, avgBody, down }) => down && hammerShape(bars[i], avgBody) },
  { id: "hanging_man", name: "Hanging Man", direction: "bearish", bars: 1, test: ({ bars, i, avgBody, up }) => up && hammerShape(bars[i], avgBody) },
  { id: "inverted_hammer", name: "Inverted Hammer", direction: "bullish", bars: 1, test: ({ bars, i, avgBody, down }) => down && invertedShape(bars[i], avgBody) },
  { id: "shooting_star", name: "Shooting Star", direction: "bearish", bars: 1, test: ({ bars, i, avgBody, up }) => up && invertedShape(bars[i], avgBody) },
  { id: "doji", name: "Doji", direction: "neutral", bars: 1, test: ({ bars, i }) => range(bars[i]) > 0 && body(bars[i]) <= range(bars[i]) * 0.08 },
];

export const CANDLE_PATTERN_NAMES = CANDLES.map((c) => c.name);

export function detectCandlePatterns(bars: Bar[], lookback = 300, includeDoji = false): CandlePattern[] {
  const out: CandlePattern[] = [];
  const n = bars.length;
  const start = Math.max(8, n - lookback);
  let bodySum = 0;
  for (let k = start - 14; k < start; k++) if (k >= 0) bodySum += body(bars[k]);
  for (let i = start; i < n; i++) {
    const avgBody = bodySum / 14 || body(bars[i]);
    for (const def of CANDLES) {
      if (def.id === "doji" && !includeDoji) continue;
      const first = i - def.bars + 1;
      if (first < 6) continue;
      // Trend before the first candle of the pattern.
      const ref = bars[first - 1].close;
      const before = bars[first - 6].close;
      // A real trend, not noise: at least 1.5 average bodies over 5 candles.
      const ctx: Ctx = { bars, i, avgBody, down: ref < before - 1.5 * avgBody, up: ref > before + 1.5 * avgBody };
      if (def.test(ctx)) {
        out.push({ index: i, time: bars[i].time, id: def.id, name: def.name, direction: def.direction, bars: def.bars });
        break;
      }
    }
    bodySum += body(bars[i]) - (i - 14 >= 0 ? body(bars[i - 14]) : 0);
  }
  return out;
}

// ---------------- chart formations ----------------

export interface Pivot {
  index: number;
  time: number;
  price: number;
  type: "high" | "low";
}

export type FormationKind = "double_top" | "double_bottom" | "head_shoulders" | "inverse_head_shoulders" | "ascending_triangle" | "descending_triangle" | "symmetrical_triangle";

export interface Formation {
  kind: FormationKind;
  name: string;
  direction: Direction;
  /** Pivots that make up the pattern, in time order. */
  points: Pivot[];
  /** Neckline / breakout level as a line between two points (time, price). */
  neckline?: [{ time: number; price: number }, { time: number; price: number }];
  /** Second boundary of a triangle. */
  lines?: [{ time: number; price: number }, { time: number; price: number }][];
  /** The price closed beyond the neckline after the pattern. */
  confirmed: boolean;
  /** Price objective: pattern height projected from the neckline. */
  target?: number;
}

export const FORMATION_NAMES: Record<FormationKind, string> = {
  double_top: "Doppeltop",
  double_bottom: "Doppelboden",
  head_shoulders: "Schulter-Kopf-Schulter",
  inverse_head_shoulders: "Inverse SKS",
  ascending_triangle: "Aufsteigendes Dreieck",
  descending_triangle: "Absteigendes Dreieck",
  symmetrical_triangle: "Symmetrisches Dreieck",
};

/** Alternating swing highs and lows (each confirmed by `k` candles on both sides). */
export function findPivots(bars: Bar[], k: number): Pivot[] {
  const raw: Pivot[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k && (isHigh || isLow); j++) {
      if (j === i) continue;
      if (j < i ? bars[j].high >= bars[i].high : bars[j].high > bars[i].high) isHigh = false;
      if (j < i ? bars[j].low <= bars[i].low : bars[j].low < bars[i].low) isLow = false;
    }
    if (isHigh) raw.push({ index: i, time: bars[i].time, price: bars[i].high, type: "high" });
    if (isLow) raw.push({ index: i, time: bars[i].time, price: bars[i].low, type: "low" });
  }
  // Two highs in a row: keep the higher one (same for lows).
  const out: Pivot[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && last.type === p.type) {
      if ((p.type === "high" && p.price > last.price) || (p.type === "low" && p.price < last.price)) out[out.length - 1] = p;
    } else out.push(p);
  }
  return out;
}

const near = (a: number, b: number, tolPct: number) => (Math.abs(a - b) / ((a + b) / 2)) * 100 <= tolPct;
const pct = (a: number, b: number) => (Math.abs(a - b) / b) * 100;

function lineAt(a: { index: number; price: number }, b: { index: number; price: number }, index: number) {
  return a.price + ((b.price - a.price) * (index - a.index)) / (b.index - a.index || 1);
}

/** Did a close break the line within `maxBars` after `from` (below for bearish, above for bullish)? */
function broke(bars: Bar[], from: number, maxBars: number, level: (i: number) => number, bearish: boolean): boolean {
  for (let i = from + 1; i < Math.min(bars.length, from + 1 + maxBars); i++) {
    if (bearish ? bars[i].close < level(i) : bars[i].close > level(i)) return true;
  }
  return false;
}

export function detectFormations(bars: Bar[], pivotLength = 5, tolerancePct = 1.5): Formation[] {
  const pv = findPivots(bars, pivotLength);
  const out: Formation[] = [];
  const minDepth = tolerancePct * 2;
  const n = bars.length;
  const recent = (p: Pivot) => p.index >= n - pivotLength * 12;
  let used = -1;

  for (let s = 0; s < pv.length; s++) {
    if (s <= used) continue;
    // Head and shoulders: H L H L H (or inverse with lows).
    const five = pv.slice(s, s + 5);
    if (five.length === 5) {
      const [l1, a, head, b, r1] = five;
      const top = l1.type === "high";
      const higher = (x: number, y: number) => (top ? x > y : x < y);
      if (higher(head.price, l1.price) && higher(head.price, r1.price) && near(l1.price, r1.price, tolerancePct * 2) && pct(head.price, Math.max(l1.price, r1.price)) >= tolerancePct && pct(head.price, (a.price + b.price) / 2) >= minDepth) {
        const neck = (i: number) => lineAt(a, b, i);
        const confirmed = broke(bars, r1.index, pivotLength * 6, neck, top);
        if (confirmed || recent(r1)) {
          const height = Math.abs(head.price - neck(head.index));
          out.push({
            kind: top ? "head_shoulders" : "inverse_head_shoulders",
            name: FORMATION_NAMES[top ? "head_shoulders" : "inverse_head_shoulders"],
            direction: top ? "bearish" : "bullish",
            points: five,
            neckline: [
              { time: a.time, price: a.price },
              { time: bars[Math.min(n - 1, r1.index + pivotLength)].time, price: neck(Math.min(n - 1, r1.index + pivotLength)) },
            ],
            confirmed,
            target: neck(r1.index) + (top ? -height : height),
          });
          used = s + 4;
          continue;
        }
      }
    }
    // Double top / bottom: H L H (or L H L).
    const three = pv.slice(s, s + 3);
    if (three.length === 3) {
      const [p1, valley, p2] = three;
      const top = p1.type === "high";
      if (near(p1.price, p2.price, tolerancePct) && pct((p1.price + p2.price) / 2, valley.price) >= minDepth && p2.index - p1.index >= pivotLength * 2) {
        const confirmed = broke(bars, p2.index, pivotLength * 6, () => valley.price, top);
        if (confirmed || recent(p2)) {
          const height = Math.abs((p1.price + p2.price) / 2 - valley.price);
          out.push({
            kind: top ? "double_top" : "double_bottom",
            name: FORMATION_NAMES[top ? "double_top" : "double_bottom"],
            direction: top ? "bearish" : "bullish",
            points: three,
            neckline: [
              { time: p1.time, price: valley.price },
              { time: bars[Math.min(n - 1, p2.index + pivotLength)].time, price: valley.price },
            ],
            confirmed,
            target: valley.price + (top ? -height : height),
          });
          used = s + 2;
        }
      }
    }
  }

  // Triangle: only the one forming now, from the last two highs and two lows.
  const highs = pv.filter((p) => p.type === "high").slice(-2);
  const lows = pv.filter((p) => p.type === "low").slice(-2);
  if (highs.length === 2 && lows.length === 2 && recent(highs[1]) && recent(lows[1])) {
    const [h1, h2] = highs;
    const [l1, l2] = lows;
    const flatH = near(h1.price, h2.price, tolerancePct);
    const flatL = near(l1.price, l2.price, tolerancePct);
    const fallingH = !flatH && h2.price < h1.price;
    const risingL = !flatL && l2.price > l1.price;
    let kind: FormationKind | null = null;
    if (flatH && risingL) kind = "ascending_triangle";
    else if (fallingH && flatL) kind = "descending_triangle";
    else if (fallingH && risingL) kind = "symmetrical_triangle";
    const last = n - 1;
    const upper = (i: number) => lineAt(h1, h2, i);
    const lower = (i: number) => lineAt(l1, l2, i);
    if (kind && upper(last) > lower(last)) {
      const end = { index: last, time: bars[last].time };
      out.push({
        kind,
        name: FORMATION_NAMES[kind],
        direction: kind === "ascending_triangle" ? "bullish" : kind === "descending_triangle" ? "bearish" : "neutral",
        points: [h1, l1, h2, l2].sort((a, b) => a.index - b.index),
        lines: [
          [{ time: h1.time, price: h1.price }, { time: end.time, price: upper(last) }],
          [{ time: l1.time, price: l1.price }, { time: end.time, price: lower(last) }],
        ],
        confirmed: false,
      });
    }
  }
  return out;
}

// ---------------- auto Fibonacci ----------------

/**
 * Retracement over the dominant swing in bars[from..to]: from the earlier of the highest
 * high / lowest low to the later one (so level 0 sits at the most recent extreme).
 */
export function autoFibonacci(bars: Bar[], from: number, to: number): { a: { time: number; price: number }; b: { time: number; price: number } } | null {
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(bars.length - 1, Math.ceil(to));
  if (hi - lo < 2) return null;
  let iHigh = lo;
  let iLow = lo;
  for (let i = lo; i <= hi; i++) {
    if (bars[i].high > bars[iHigh].high) iHigh = i;
    if (bars[i].low < bars[iLow].low) iLow = i;
  }
  if (iHigh === iLow) return null;
  const high = { time: bars[iHigh].time, price: bars[iHigh].high };
  const low = { time: bars[iLow].time, price: bars[iLow].low };
  return iLow < iHigh ? { a: low, b: high } : { a: high, b: low };
}
