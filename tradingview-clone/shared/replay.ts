// Bar replay: the chart is cut off at a chosen candle and the following candles are revealed one by one.

import type { Bar } from "./math";

/** Candles per second the replay can play at. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 3, 5, 10];

/** Index of the candle that contains `time` (the last one starting at or before it); -1 before the first. */
export function barIndexAt(bars: Bar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * How many candles of a series with another time frame (`next`) can be shown at the moment a replay has
 * reached: only candles that ended before the first hidden candle of `all` started, so nothing of the
 * future shows through.
 */
export function carryReplay(all: Bar[], shown: number, next: Bar[]): number {
  if (shown >= all.length) return next.length;
  const until = all[shown].time;
  let n = 0;
  // A candle ends where the next one starts; the last loaded one has not ended yet.
  while (n < next.length - 1 && next[n + 1].time <= until) n++;
  return n;
}

/**
 * The prices a candle runs through, in a plausible order: a rising candle first dips to its low,
 * a falling one first climbs to its high. Stops and targets inside the candle are hit along this path.
 */
export function barPath(bar: Bar): number[] {
  return bar.close >= bar.open ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close];
}

/** A random start that leaves history before it and candles to play after it. */
export function randomStart(length: number, rand = Math.random): number {
  if (length < 3) return Math.max(0, length - 2);
  const from = Math.floor(length * 0.2);
  const to = Math.max(from, Math.floor(length * 0.85));
  return from + Math.floor(rand() * (to - from + 1));
}
