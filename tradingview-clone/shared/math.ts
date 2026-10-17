// Pure indicator math. Every function returns an array aligned to the input
// (same length), with `null` where the indicator is not yet defined.

export interface Bar {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Series = (number | null)[];

const nulls = (n: number): Series => new Array<number | null>(n).fill(null);

export function sma(values: Series, period: number): Series {
  const out = nulls(values.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > period) {
      sum -= values[i - period] as number;
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

// EMA seeded with the SMA of the first `period` defined values (TradingView behaviour).
export function ema(values: Series, period: number, alpha = 2 / (period + 1)): Series {
  const out = nulls(values.length);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (prev === null) {
      seedSum += v;
      seedCount++;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

// Wilder's smoothing (RMA), used by RSI, ATR, ADX.
export const rma = (values: Series, period: number): Series => ema(values, period, 1 / period);

export function wma(values: Series, period: number): Series {
  const out = nulls(values.length);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let acc = 0;
    let ok = true;
    for (let j = 0; j < period; j++) {
      const v = values[i - j];
      if (v === null) {
        ok = false;
        break;
      }
      acc += v * (period - j);
    }
    if (ok) out[i] = acc / denom;
  }
  return out;
}

export function hma(values: Series, period: number): Series {
  const half = wma(values, Math.max(1, Math.floor(period / 2)));
  const full = wma(values, period);
  const diff = half.map((h, i) => (h === null || full[i] === null ? null : 2 * h - (full[i] as number)));
  return wma(diff, Math.max(1, Math.round(Math.sqrt(period))));
}

export function stdev(values: Series, period: number): Series {
  const mean = sma(values, period);
  return values.map((_, i) => {
    const m = mean[i];
    if (m === null) return null;
    let acc = 0;
    for (let j = 0; j < period; j++) acc += ((values[i - j] as number) - m) ** 2;
    return Math.sqrt(acc / period);
  });
}

export function highest(values: Series, period: number): Series {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    let m = -Infinity;
    for (let j = 0; j < period; j++) m = Math.max(m, values[i - j] ?? -Infinity);
    return Number.isFinite(m) ? m : null;
  });
}

export function lowest(values: Series, period: number): Series {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    let m = Infinity;
    for (let j = 0; j < period; j++) m = Math.min(m, values[i - j] ?? Infinity);
    return Number.isFinite(m) ? m : null;
  });
}

const sub = (a: Series, b: Series): Series =>
  a.map((v, i) => (v === null || b[i] === null ? null : v - (b[i] as number)));

export const closes = (bars: Bar[]): Series => bars.map((b) => b.close);
export const hlc3 = (bars: Bar[]): Series => bars.map((b) => (b.high + b.low + b.close) / 3);

export function trueRange(bars: Bar[]): Series {
  return bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)),
  );
}

export const atr = (bars: Bar[], period: number): Series => rma(trueRange(bars), period);

export function vwma(bars: Bar[], period: number): Series {
  const pv = sma(bars.map((b) => b.close * b.volume), period);
  const v = sma(bars.map((b) => b.volume), period);
  return pv.map((x, i) => (x === null || !v[i] ? null : x / (v[i] as number)));
}

// Session VWAP, reset at every UTC day boundary.
export function vwap(bars: Bar[]): Series {
  let day = -1;
  let pv = 0;
  let vol = 0;
  return bars.map((b) => {
    const d = Math.floor(b.time / 86400);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    vol += b.volume;
    return vol > 0 ? pv / vol : tp;
  });
}

export function bollinger(values: Series, period: number, mult: number) {
  const basis = sma(values, period);
  const dev = stdev(values, period);
  return {
    basis,
    upper: basis.map((m, i) => (m === null ? null : m + mult * (dev[i] as number))),
    lower: basis.map((m, i) => (m === null ? null : m - mult * (dev[i] as number))),
  };
}

export function keltner(bars: Bar[], period: number, mult: number, atrPeriod: number) {
  const basis = ema(closes(bars), period);
  const a = atr(bars, atrPeriod);
  return {
    basis,
    upper: basis.map((m, i) => (m === null || a[i] === null ? null : m + mult * (a[i] as number))),
    lower: basis.map((m, i) => (m === null || a[i] === null ? null : m - mult * (a[i] as number))),
  };
}

export function donchian(bars: Bar[], period: number) {
  const upper = highest(bars.map((b) => b.high), period);
  const lower = lowest(bars.map((b) => b.low), period);
  return {
    upper,
    lower,
    basis: upper.map((u, i) => (u === null || lower[i] === null ? null : (u + (lower[i] as number)) / 2)),
  };
}

export function rsi(values: Series, period: number): Series {
  const gains: Series = values.map((v, i) => (i === 0 || v === null ? null : Math.max(v - (values[i - 1] as number), 0)));
  const losses: Series = values.map((v, i) => (i === 0 || v === null ? null : Math.max((values[i - 1] as number) - v, 0)));
  const g = rma(gains, period);
  const l = rma(losses, period);
  return g.map((gv, i) => {
    const lv = l[i];
    if (gv === null || lv === null) return null;
    if (lv === 0) return 100;
    return 100 - 100 / (1 + gv / lv);
  });
}

export function macd(values: Series, fast: number, slow: number, signal: number) {
  const line = sub(ema(values, fast), ema(values, slow));
  const sig = ema(line, signal);
  return { macd: line, signal: sig, histogram: sub(line, sig) };
}

export function stochastic(bars: Bar[], kPeriod: number, kSmooth: number, dPeriod: number) {
  const hh = highest(bars.map((b) => b.high), kPeriod);
  const ll = lowest(bars.map((b) => b.low), kPeriod);
  const raw = bars.map((b, i) => {
    const h = hh[i];
    const l = ll[i];
    if (h === null || l === null) return null;
    return h === l ? 50 : (100 * (b.close - l)) / (h - l);
  });
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dPeriod) };
}

export function stochRsi(values: Series, rsiPeriod: number, stochPeriod: number, kSmooth: number, dSmooth: number) {
  const r = rsi(values, rsiPeriod);
  const hh = highest(r, stochPeriod);
  const ll = lowest(r, stochPeriod);
  const raw = r.map((v, i) => {
    const h = hh[i];
    const l = ll[i];
    if (v === null || h === null || l === null) return null;
    return h === l ? 50 : (100 * (v - l)) / (h - l);
  });
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dSmooth) };
}

export function adx(bars: Bar[], period: number) {
  const plusDM: Series = bars.map((b, i) => {
    if (i === 0) return null;
    const up = b.high - bars[i - 1].high;
    const down = bars[i - 1].low - b.low;
    return up > down && up > 0 ? up : 0;
  });
  const minusDM: Series = bars.map((b, i) => {
    if (i === 0) return null;
    const up = b.high - bars[i - 1].high;
    const down = bars[i - 1].low - b.low;
    return down > up && down > 0 ? down : 0;
  });
  const tr = rma(trueRange(bars).map((v, i) => (i === 0 ? null : v)), period);
  const pdm = rma(plusDM, period);
  const mdm = rma(minusDM, period);
  const plusDI = pdm.map((v, i) => (v === null || !tr[i] ? null : (100 * v) / (tr[i] as number)));
  const minusDI = mdm.map((v, i) => (v === null || !tr[i] ? null : (100 * v) / (tr[i] as number)));
  const dx = plusDI.map((p, i) => {
    const m = minusDI[i];
    if (p === null || m === null) return null;
    return p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m);
  });
  return { adx: rma(dx, period), plusDI, minusDI };
}

export function cci(bars: Bar[], period: number): Series {
  const tp = hlc3(bars);
  const mean = sma(tp, period);
  return tp.map((v, i) => {
    const m = mean[i];
    if (m === null || v === null) return null;
    let dev = 0;
    for (let j = 0; j < period; j++) dev += Math.abs((tp[i - j] as number) - m);
    dev /= period;
    return dev === 0 ? 0 : (v - m) / (0.015 * dev);
  });
}

export function williamsR(bars: Bar[], period: number): Series {
  const hh = highest(bars.map((b) => b.high), period);
  const ll = lowest(bars.map((b) => b.low), period);
  return bars.map((b, i) => {
    const h = hh[i];
    const l = ll[i];
    if (h === null || l === null) return null;
    return h === l ? -50 : (-100 * (h - b.close)) / (h - l);
  });
}

export function mfi(bars: Bar[], period: number): Series {
  const tp = hlc3(bars) as number[];
  return bars.map((_, i) => {
    if (i < period) return null;
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * bars[j].volume;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  });
}

export function obv(bars: Bar[]): Series {
  let acc = 0;
  return bars.map((b, i) => {
    if (i > 0) {
      if (b.close > bars[i - 1].close) acc += b.volume;
      else if (b.close < bars[i - 1].close) acc -= b.volume;
    }
    return acc;
  });
}

export function cmf(bars: Bar[], period: number): Series {
  const mfv = bars.map((b) => (b.high === b.low ? 0 : ((b.close - b.low - (b.high - b.close)) / (b.high - b.low)) * b.volume));
  const a = sma(mfv, period);
  const v = sma(bars.map((b) => b.volume), period);
  return a.map((x, i) => (x === null || !v[i] ? null : x / (v[i] as number)));
}

export function roc(values: Series, period: number): Series {
  return values.map((v, i) => {
    const prev = values[i - period];
    return i < period || v === null || prev === null || prev === undefined || prev === 0 ? null : (100 * (v - prev)) / prev;
  });
}

export function momentum(values: Series, period: number): Series {
  return values.map((v, i) => {
    const prev = values[i - period];
    return i < period || v === null || prev === null || prev === undefined ? null : v - prev;
  });
}

export function awesomeOscillator(bars: Bar[], fast = 5, slow = 34): Series {
  const median = bars.map((b) => (b.high + b.low) / 2);
  return sub(sma(median, fast), sma(median, slow));
}

export function trix(values: Series, period: number): Series {
  const e3 = ema(ema(ema(values, period), period), period);
  return e3.map((v, i) => {
    const prev = e3[i - 1];
    return v === null || prev === null || prev === undefined || prev === 0 ? null : (10000 * (v - prev)) / prev;
  });
}

export function ichimoku(bars: Bar[], conv: number, base: number, spanB: number) {
  const mid = (p: number) => {
    const h = highest(bars.map((b) => b.high), p);
    const l = lowest(bars.map((b) => b.low), p);
    return h.map((v, i) => (v === null || l[i] === null ? null : (v + (l[i] as number)) / 2));
  };
  const tenkan = mid(conv);
  const kijun = mid(base);
  return {
    tenkan,
    kijun,
    // Spans are plotted `base` bars into the future, chikou `base` bars into the past
    // (the offsets are applied by the indicator registry, not here).
    spanA: tenkan.map((t, i) => (t === null || kijun[i] === null ? null : (t + (kijun[i] as number)) / 2)),
    spanB: mid(spanB),
    chikou: closes(bars),
  };
}

export function parabolicSar(bars: Bar[], start: number, increment: number, maximum: number): Series {
  const out = nulls(bars.length);
  if (bars.length < 2) return out;
  let up = bars[1].close >= bars[0].close;
  let af = start;
  let ep = up ? bars[0].high : bars[0].low;
  let sar = up ? bars[0].low : bars[0].high;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, bars[i - 1].low, bars[Math.max(0, i - 2)].low);
      if (b.low < sar) {
        up = false;
        sar = ep;
        ep = b.low;
        af = start;
      } else if (b.high > ep) {
        ep = b.high;
        af = Math.min(af + increment, maximum);
      }
    } else {
      sar = Math.max(sar, bars[i - 1].high, bars[Math.max(0, i - 2)].high);
      if (b.high > sar) {
        up = true;
        sar = ep;
        ep = b.high;
        af = start;
      } else if (b.low < ep) {
        ep = b.low;
        af = Math.min(af + increment, maximum);
      }
    }
    out[i] = sar;
  }
  return out;
}

export function supertrend(bars: Bar[], period: number, mult: number) {
  const a = atr(bars, period);
  const up = nulls(bars.length);
  const down = nulls(bars.length);
  let finalUpper = 0;
  let finalLower = 0;
  let trendUp = true;
  let started = false;
  for (let i = 0; i < bars.length; i++) {
    const atrV = a[i];
    if (atrV === null) continue;
    const b = bars[i];
    const mid = (b.high + b.low) / 2;
    const basicUpper = mid + mult * atrV;
    const basicLower = mid - mult * atrV;
    const prevClose = i > 0 ? bars[i - 1].close : b.close;
    if (!started) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      trendUp = b.close >= mid;
      started = true;
    } else {
      finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
      if (trendUp && b.close < finalLower) trendUp = false;
      else if (!trendUp && b.close > finalUpper) trendUp = true;
    }
    if (trendUp) up[i] = finalLower;
    else down[i] = finalUpper;
  }
  return { up, down };
}

export function envelope(values: Series, period: number, percent: number) {
  const basis = sma(values, period);
  return {
    basis,
    upper: basis.map((m) => (m === null ? null : m * (1 + percent / 100))),
    lower: basis.map((m) => (m === null ? null : m * (1 - percent / 100))),
  };
}

// Classic floor-trader pivots computed from the previous UTC day (or previous
// bar block when bars are daily or larger: previous week).
export function pivotPoints(bars: Bar[]) {
  const keys = ["p", "r1", "r2", "r3", "s1", "s2", "s3"] as const;
  const out: Record<(typeof keys)[number], Series> = Object.fromEntries(keys.map((k) => [k, nulls(bars.length)])) as never;
  if (bars.length < 2) return out;
  const step = bars[1].time - bars[0].time;
  const bucketSize = step >= 86400 ? 7 * 86400 : 86400;
  const bucket = (t: number) => Math.floor((t + (bucketSize === 7 * 86400 ? 3 * 86400 : 0)) / bucketSize);
  let curBucket = bucket(bars[0].time);
  let hi = -Infinity;
  let lo = Infinity;
  let cl = 0;
  let levels: Record<string, number> | null = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const k = bucket(b.time);
    if (k !== curBucket) {
      const p = (hi + lo + cl) / 3;
      levels = {
        p,
        r1: 2 * p - lo,
        s1: 2 * p - hi,
        r2: p + (hi - lo),
        s2: p - (hi - lo),
        r3: hi + 2 * (p - lo),
        s3: lo - 2 * (hi - p),
      };
      curBucket = k;
      hi = -Infinity;
      lo = Infinity;
    }
    hi = Math.max(hi, b.high);
    lo = Math.min(lo, b.low);
    cl = b.close;
    if (levels) for (const key of keys) out[key][i] = levels[key];
  }
  return out;
}

export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), volume: b.volume });
  }
  return out;
}
