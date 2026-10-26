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

// ---------------- Intrabar replay ----------------
// As TradingView's bar replay with an update interval below the chart's: the next candle is built step by step
// from candles of a lower time frame (open of the first, highest high, lowest low, close of the last).

/** The lower-time-frame candles inside candle `index` of `all` (from its start to the next candle's). */
export function subBarsOf(sub: Bar[], all: Bar[], index: number): Bar[] {
  if (index < 0 || index >= all.length) return [];
  const from = all[index].time;
  const to = index + 1 < all.length ? all[index + 1].time : Infinity;
  const out: Bar[] = [];
  for (let i = Math.max(0, barIndexAt(sub, from - 1) + 1); i < sub.length && sub[i].time < to; i++) if (sub[i].time >= from) out.push(sub[i]);
  return out;
}

/** One candle from consecutive lower-time-frame candles, stamped with the time of the candle they build. */
export function mergeBars(parts: Bar[], time: number): Bar {
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const p of parts) {
    high = Math.max(high, p.high);
    low = Math.min(low, p.low);
    volume += p.volume;
  }
  return { time, open: parts[0].open, high, low, close: parts[parts.length - 1].close, volume };
}

/** The candles a replay shows: `shown` whole candles plus the next one built from its first `sub` parts. */
export function replayFrame(all: Bar[], shown: number, sub: number, subBars: Bar[] | null): Bar[] {
  const whole = all.slice(0, shown);
  if (!sub || !subBars || shown >= all.length) return whole;
  const parts = subBarsOf(subBars, all, shown).slice(0, sub);
  return parts.length ? [...whole, mergeBars(parts, all[shown].time)] : whole;
}

/** The replay position after one step: the next part of the coming candle, or the whole candle when it is complete or has no parts. */
export function nextReplayStep(all: Bar[], shown: number, sub: number, subBars: Bar[] | null): { shown: number; sub: number } {
  if (shown >= all.length) return { shown, sub: 0 };
  const parts = subBars ? subBarsOf(subBars, all, shown).length : 0;
  return sub + 1 < parts ? { shown, sub: sub + 1 } : { shown: shown + 1, sub: 0 };
}

/** Lower time frames a candle of `interval` (seconds) can be replayed in: they divide it, at least 2 and at most 1440 parts. */
export function intrabarIntervals(intervalSec: number, candidates: { id: string; seconds: number }[]): string[] {
  return candidates.filter((c) => c.seconds < intervalSec && intervalSec % c.seconds === 0 && intervalSec / c.seconds <= 1440).map((c) => c.id);
}
