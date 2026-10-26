import type { Bar } from "./math";

/**
 * Market structure: Break of Structure (BOS) and Change of Character (CHoCH), ported from
 * smart-money-concepts `smc.swing_highs_lows` and `smc.bos_choch`
 * (github.com/joshyattridge/smart-money-concepts, smartmoneyconcepts/smc.py).
 * - Swing high: the high equals the highest high of the `swing` candles before and after
 *   (window i-swing+1 … i+swing); swing low likewise. Of two highs (lows) in a row only the
 *   higher (lower) one stays. The first and last candle get the opposite of the nearest swing.
 * - Four swings low-high-low-high: BOS bullish when L1 < L2 < H1 < H2 (trend continues),
 *   CHoCH bullish when H2 > H1 > L1 > L2 (lower low, then a higher high breaks the trend).
 *   Bearish mirrored. The level is H1 (bearish: L1), marked at its candle.
 * - A level counts once a later close (closeBreak) or high/low crosses it, starting two
 *   candles after the swing; unbroken levels are dropped, and an earlier one whose break
 *   comes at or after a newer one's break is replaced by the newer.
 * Like the source, swings need `swing` candles to the right, so recent levels appear late.
 */
export interface StructureBreak {
  kind: "bos" | "choch";
  side: "bull" | "bear";
  level: number;
  /** Candle of the swing whose level was broken. */
  index: number;
  time: number;
  /** First candle that closed (or traded) through the level. */
  brokenIndex: number;
  brokenTime: number;
}

/** 1 = swing high, -1 = swing low, 0 = none (smc `HighLow`). */
export function swingHighsLows(bars: Bar[], swing: number): number[] {
  const n = bars.length;
  const hl = new Array<number>(n).fill(0);
  for (let i = 2 * swing - 1; i + swing <= n - 1; i++) {
    let max = -Infinity;
    let min = Infinity;
    for (let j = i - swing + 1; j <= i + swing; j++) {
      max = Math.max(max, bars[j].high);
      min = Math.min(min, bars[j].low);
    }
    if (bars[i].high === max) hl[i] = 1;
    else if (bars[i].low === min) hl[i] = -1;
  }
  for (;;) {
    const pos = hl.flatMap((v, i) => (v !== 0 ? [i] : []));
    if (pos.length < 2) break;
    const remove = new Array<boolean>(pos.length).fill(false);
    for (let k = 0; k < pos.length - 1; k++) {
      const [a, b] = [pos[k], pos[k + 1]];
      if (hl[a] === 1 && hl[b] === 1) remove[bars[a].high < bars[b].high ? k : k + 1] = true;
      else if (hl[a] === -1 && hl[b] === -1) remove[bars[a].low > bars[b].low ? k : k + 1] = true;
    }
    if (!remove.includes(true)) break;
    pos.forEach((p, k) => remove[k] && (hl[p] = 0));
  }
  const pos = hl.flatMap((v, i) => (v !== 0 ? [i] : []));
  if (pos.length > 0) {
    const [first, last] = [hl[pos[0]], hl[pos[pos.length - 1]]];
    hl[0] = -first;
    hl[n - 1] = -last;
  }
  return hl;
}

export function marketStructure(bars: Bar[], swing: number, closeBreak = true): StructureBreak[] {
  const n = bars.length;
  if (n < 2 * swing + 1) return [];
  const hl = swingHighsLows(bars, swing);
  const bos = new Array<number>(n).fill(0);
  const choch = new Array<number>(n).fill(0);
  const level = new Array<number>(n).fill(0);
  const levels: number[] = [];
  const types: number[] = [];
  const positions: number[] = [];
  const is = (t: number[], want: number[]) => t.every((v, k) => v === want[k]);
  for (let i = 0; i < n; i++) {
    if (hl[i] === 0) continue;
    levels.push(hl[i] === 1 ? bars[i].high : bars[i].low);
    types.push(hl[i]);
    if (levels.length >= 4) {
      const p = positions[positions.length - 2];
      const [l4, l3, l2, l1] = levels.slice(-4);
      const t = types.slice(-4);
      const bull = is(t, [-1, 1, -1, 1]);
      const bear = is(t, [1, -1, 1, -1]);
      bos[p] = bull && l4 < l2 && l2 < l3 && l3 < l1 ? 1 : bear && l4 > l2 && l2 > l3 && l3 > l1 ? -1 : 0;
      choch[p] = bull && l1 > l3 && l3 > l4 && l4 > l2 ? 1 : bear && l1 < l3 && l3 < l4 && l4 < l2 ? -1 : 0;
      level[p] = bos[p] !== 0 || choch[p] !== 0 ? l3 : 0;
    }
    positions.push(i);
  }

  const broken = new Array<number>(n).fill(0);
  const marked = () => bos.flatMap((b, i) => (b !== 0 || choch[i] !== 0 ? [i] : []));
  for (const i of marked()) {
    const up = bos[i] === 1 || choch[i] === 1;
    let j = -1;
    for (let k = i + 2; k < n; k++) {
      const price = closeBreak ? bars[k].close : up ? bars[k].high : bars[k].low;
      if (up ? price > level[i] : price < level[i]) {
        j = k;
        break;
      }
    }
    if (j < 0) continue;
    broken[i] = j;
    for (const k of marked()) if (k < i && broken[k] >= j) bos[k] = choch[k] = level[k] = 0;
  }

  return marked()
    .filter((i) => broken[i] !== 0)
    .map((i) => {
      const dir = bos[i] || choch[i];
      return {
        kind: bos[i] !== 0 ? "bos" : "choch",
        side: dir > 0 ? "bull" : "bear",
        level: level[i],
        index: i,
        time: bars[i].time,
        brokenIndex: broken[i],
        brokenTime: bars[broken[i]].time,
      };
    });
}
