// Pure indicator math. Every function returns an array aligned to the input
// (same length), with `null` where the indicator is not yet defined.

export interface Bar {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Taker-buy volume (Binance); other sources leave it out and it is estimated.
  buyVolume?: number;
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

// ---------------------------------------------------------------------------
// Additional moving averages
// ---------------------------------------------------------------------------

const combine = (a: Series, b: Series, f: (x: number, y: number) => number): Series =>
  a.map((v, i) => (v === null || b[i] === null || b[i] === undefined ? null : f(v, b[i] as number)));

export const hl2 = (bars: Bar[]): Series => bars.map((b) => (b.high + b.low) / 2);

export function dema(values: Series, period: number): Series {
  const e1 = ema(values, period);
  return combine(e1, ema(e1, period), (a, b) => 2 * a - b);
}

export function tema(values: Series, period: number): Series {
  const e1 = ema(values, period);
  const e2 = ema(e1, period);
  const e3 = ema(e2, period);
  return e1.map((v, i) => (v === null || e2[i] === null || e3[i] === null ? null : 3 * v - 3 * (e2[i] as number) + (e3[i] as number)));
}

/** Kaufman Adaptive Moving Average. */
export function kama(values: Series, period: number, fast = 2, slow = 30): Series {
  const out = new Array<number | null>(values.length).fill(null);
  const fastSc = 2 / (fast + 1);
  const slowSc = 2 / (slow + 1);
  let prev: number | null = null;
  for (let i = period; i < values.length; i++) {
    const v = values[i];
    const start = values[i - period];
    if (v === null || start === null) continue;
    let noise = 0;
    for (let j = i - period + 1; j <= i; j++) noise += Math.abs((values[j] as number) - (values[j - 1] as number));
    const er = noise === 0 ? 0 : Math.abs(v - start) / noise;
    const sc = (er * (fastSc - slowSc) + slowSc) ** 2;
    prev = prev === null ? (values[i - 1] as number) : prev;
    prev = prev + sc * (v - prev);
    out[i] = prev;
  }
  return out;
}

/** Arnaud Legoux Moving Average. */
export function alma(values: Series, period: number, offset = 0.85, sigma = 6): Series {
  const m = offset * (period - 1);
  const s = period / sigma;
  const weights = Array.from({ length: period }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * s * s)));
  const wSum = weights.reduce((a, b) => a + b, 0);
  return values.map((_, i) => {
    if (i < period - 1) return null;
    let acc = 0;
    for (let k = 0; k < period; k++) {
      const v = values[i - period + 1 + k];
      if (v === null) return null;
      acc += v * weights[k];
    }
    return acc / wSum;
  });
}

/** Least-squares fit over the last `period` values: slope, intercept and value at the last point. */
function linFit(values: Series, end: number, period: number) {
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < period; k++) {
    const y = values[end - period + 1 + k] as number;
    sx += k;
    sy += y;
    sxy += k * y;
    sxx += k * k;
  }
  const slope = (period * sxy - sx * sy) / (period * sxx - sx * sx || 1);
  const intercept = (sy - slope * sx) / period;
  return { slope, intercept, last: intercept + slope * (period - 1) };
}

/** Linear regression curve (LSMA): endpoint of the regression line over each window. */
export function linreg(values: Series, period: number): Series {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    for (let k = i - period + 1; k <= i; k++) if (values[k] === null) return null;
    return linFit(values, i, period).last;
  });
}

export function mcginley(values: Series, period: number): Series {
  let prev: number | null = null;
  return values.map((v) => {
    if (v === null) return null;
    prev = prev === null ? v : prev + (v - prev) / (period * (v / prev) ** 4);
    return prev;
  });
}

// ---------------------------------------------------------------------------
// Bands, stops and price structure
// ---------------------------------------------------------------------------

/** Session VWAP (UTC day) with volume-weighted standard deviation bands. */
export function vwapBands(bars: Bar[], mult1: number, mult2: number) {
  let day = -1;
  let pv = 0;
  let pv2 = 0;
  let vol = 0;
  const vwapS: Series = [];
  const dev: number[] = [];
  for (const b of bars) {
    const d = Math.floor(b.time / 86400);
    if (d !== day) {
      day = d;
      pv = 0;
      pv2 = 0;
      vol = 0;
    }
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    pv2 += tp * tp * b.volume;
    vol += b.volume;
    const mean = vol > 0 ? pv / vol : tp;
    vwapS.push(mean);
    dev.push(vol > 0 ? Math.sqrt(Math.max(0, pv2 / vol - mean * mean)) : 0);
  }
  const band = (m: number) => vwapS.map((v, i) => (v as number) + m * dev[i]);
  return { vwap: vwapS, upper1: band(mult1), lower1: band(-mult1), upper2: band(mult2), lower2: band(-mult2) };
}

/** VWAP anchored `barsBack` bars before the last bar. */
export function anchoredVwap(bars: Bar[], barsBack: number): Series {
  const start = Math.max(0, bars.length - barsBack);
  let pv = 0;
  let vol = 0;
  return bars.map((b, i) => {
    if (i < start) return null;
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    vol += b.volume;
    return vol > 0 ? pv / vol : tp;
  });
}

/**
 * Chandelier Exit (Chuck LeBeau, as in StockCharts ChartSchool): highest high − ATR × mult
 * for longs, lowest low + ATR × mult for shorts; the stop flips with the trend.
 */
export function chandelierExit(bars: Bar[], period: number, mult: number) {
  const a = atr(bars, period);
  const hh = highest(bars.map((b) => b.high), period);
  const ll = lowest(bars.map((b) => b.low), period);
  const long: Series = new Array(bars.length).fill(null);
  const short: Series = new Array(bars.length).fill(null);
  let longStop = 0;
  let shortStop = 0;
  let dir = 1;
  let started = false;
  for (let i = 0; i < bars.length; i++) {
    if (a[i] === null || hh[i] === null || ll[i] === null) continue;
    const ls = (hh[i] as number) - mult * (a[i] as number);
    const ss = (ll[i] as number) + mult * (a[i] as number);
    const prevClose = i > 0 ? bars[i - 1].close : bars[i].close;
    if (!started) {
      longStop = ls;
      shortStop = ss;
      started = true;
    } else {
      longStop = prevClose > longStop ? Math.max(ls, longStop) : ls;
      shortStop = prevClose < shortStop ? Math.min(ss, shortStop) : ss;
    }
    const c = bars[i].close;
    if (c > shortStop) dir = 1;
    else if (c < longStop) dir = -1;
    if (dir === 1) long[i] = longStop;
    else short[i] = shortStop;
  }
  return { long, short };
}

/** Bill Williams Alligator (smoothed MAs of hl2; offsets applied by the registry). */
export function alligator(bars: Bar[], jaw: number, teeth: number, lips: number) {
  const m = hl2(bars);
  return { jaw: rma(m, jaw), teeth: rma(m, teeth), lips: rma(m, lips) };
}

/** Bill Williams fractals: a high (low) with `n` lower highs (higher lows) on each side. */
export function fractals(bars: Bar[], n: number) {
  const up: Series = new Array(bars.length).fill(null);
  const down: Series = new Array(bars.length).fill(null);
  for (let i = n; i < bars.length - n; i++) {
    let isUp = true;
    let isDown = true;
    for (let k = 1; k <= n; k++) {
      if (bars[i - k].high >= bars[i].high || bars[i + k].high >= bars[i].high) isUp = false;
      if (bars[i - k].low <= bars[i].low || bars[i + k].low <= bars[i].low) isDown = false;
    }
    if (isUp) up[i] = bars[i].high;
    if (isDown) down[i] = bars[i].low;
  }
  return { up, down };
}

/** ZigZag: swing points that reverse by at least `pct` percent, linearly joined. */
export function zigzag(bars: Bar[], pct: number): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length < 2) return out;
  type Pivot = { i: number; price: number };
  const pivots: Pivot[] = [];
  const f = pct / 100;
  let dir = 0; // 1 = rising leg, -1 = falling leg, 0 = undecided
  let hi: Pivot = { i: 0, price: bars[0].high };
  let lo: Pivot = { i: 0, price: bars[0].low };
  let ext: Pivot = hi;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (dir === 0) {
      if (b.high > hi.price) hi = { i, price: b.high };
      if (b.low < lo.price) lo = { i, price: b.low };
      if (hi.price >= lo.price * (1 + f)) {
        const first = lo.i <= hi.i ? lo : hi;
        pivots.push(first);
        dir = first === lo ? 1 : -1;
        ext = first === lo ? hi : lo;
      }
    } else if (dir === 1) {
      if (b.high > ext.price) ext = { i, price: b.high };
      else if (b.low <= ext.price * (1 - f)) {
        pivots.push(ext);
        dir = -1;
        ext = { i, price: b.low };
      }
    } else if (b.low < ext.price) ext = { i, price: b.low };
    else if (b.high >= ext.price * (1 + f)) {
      pivots.push(ext);
      dir = 1;
      ext = { i, price: b.high };
    }
  }
  if (dir !== 0) pivots.push(ext);
  for (let p = 1; p < pivots.length; p++) {
    const a = pivots[p - 1];
    const b = pivots[p];
    for (let i = a.i; i <= b.i; i++) out[i] = b.i === a.i ? b.price : a.price + ((b.price - a.price) * (i - a.i)) / (b.i - a.i);
  }
  return out;
}

/** Linear regression channel over the last `period` bars (null before). */
export function linRegChannel(values: Series, period: number, dev: number) {
  const n = values.length;
  const basis: Series = new Array(n).fill(null);
  const upper: Series = new Array(n).fill(null);
  const lower: Series = new Array(n).fill(null);
  if (n < period || values.slice(n - period).some((v) => v === null)) return { basis, upper, lower };
  const { slope, intercept } = linFit(values, n - 1, period);
  let sq = 0;
  for (let k = 0; k < period; k++) sq += ((values[n - period + k] as number) - (intercept + slope * k)) ** 2;
  const sd = Math.sqrt(sq / period);
  for (let k = 0; k < period; k++) {
    const y = intercept + slope * k;
    basis[n - period + k] = y;
    upper[n - period + k] = y + dev * sd;
    lower[n - period + k] = y - dev * sd;
  }
  return { basis, upper, lower };
}

// ---------------------------------------------------------------------------
// Higher-timeframe helpers (crypto cycle indicators are defined on D / W)
// ---------------------------------------------------------------------------

/**
 * Evaluates `calc` on the closes of a higher timeframe for every bar: the
 * completed buckets plus the still-forming one (whose close is this bar's close).
 */
export function onHigherTimeframe(bars: Bar[], bucketSeconds: number, calc: (closes: number[]) => number | null): Series {
  // Weekly buckets start on Monday (1970-01-01 was a Thursday).
  const shift = bucketSeconds === 604800 ? 3 * 86400 : 0;
  const completed: number[] = [];
  let bucket: number | null = null;
  let lastClose = 0;
  return bars.map((b) => {
    const k = Math.floor((b.time + shift) / bucketSeconds);
    if (bucket !== null && k !== bucket) completed.push(lastClose);
    bucket = k;
    lastClose = b.close;
    completed.push(b.close);
    const v = calc(completed);
    completed.pop();
    return v;
  });
}

export const smaLast = (xs: number[], period: number): number | null => {
  if (xs.length < period) return null;
  let s = 0;
  for (let i = xs.length - period; i < xs.length; i++) s += xs[i];
  return s / period;
};

export const emaLast = (xs: number[], period: number): number | null => {
  if (xs.length < period) return null;
  const alpha = 2 / (period + 1);
  let e = smaLast(xs.slice(0, period), period) as number;
  for (let i = period; i < xs.length; i++) e = alpha * xs[i] + (1 - alpha) * e;
  return e;
};

// ---------------------------------------------------------------------------
// Momentum / oscillators popular with crypto traders
// ---------------------------------------------------------------------------

/** WaveTrend oscillator (LazyBear). */
export function waveTrend(bars: Bar[], channel: number, average: number) {
  const ap = hlc3(bars);
  const esa = ema(ap, channel);
  const d = ema(ap.map((v, i) => (v === null || esa[i] === null ? null : Math.abs(v - (esa[i] as number)))), channel);
  const ci = ap.map((v, i) => (v === null || esa[i] === null || !d[i] ? null : (v - (esa[i] as number)) / (0.015 * (d[i] as number))));
  const wt1 = ema(ci, average);
  const wt2 = sma(wt1, 4);
  return { wt1, wt2, diff: combine(wt1, wt2, (a, b) => a - b) };
}

/** Squeeze Momentum (LazyBear): momentum histogram plus squeeze state (1 = on, 0 = off). */
export function squeezeMomentum(bars: Bar[], length: number, bbMult: number, kcMult: number) {
  const c = closes(bars);
  const bb = bollinger(c, length, bbMult);
  const basis = sma(c, length);
  const range = sma(trueRange(bars), length);
  const hh = highest(bars.map((b) => b.high), length);
  const ll = lowest(bars.map((b) => b.low), length);
  const squeeze: Series = bars.map((_, i) => {
    if (bb.upper[i] === null || basis[i] === null || range[i] === null) return null;
    const kcUpper = (basis[i] as number) + kcMult * (range[i] as number);
    const kcLower = (basis[i] as number) - kcMult * (range[i] as number);
    return (bb.lower[i] as number) > kcLower && (bb.upper[i] as number) < kcUpper ? 1 : 0;
  });
  const src = c.map((v, i) =>
    v === null || hh[i] === null || ll[i] === null || basis[i] === null
      ? null
      : v - (((hh[i] as number) + (ll[i] as number)) / 2 + (basis[i] as number)) / 2,
  );
  return { momentum: linreg(src, length), squeeze };
}

export function ultimateOscillator(bars: Bar[], p1: number, p2: number, p3: number): Series {
  const bp: number[] = [];
  const tr: number[] = [];
  bars.forEach((b, i) => {
    const prevClose = i > 0 ? bars[i - 1].close : b.close;
    bp.push(b.close - Math.min(b.low, prevClose));
    tr.push(Math.max(b.high, prevClose) - Math.min(b.low, prevClose));
  });
  const avg = (i: number, p: number) => {
    let s1 = 0;
    let s2 = 0;
    for (let k = i - p + 1; k <= i; k++) {
      s1 += bp[k];
      s2 += tr[k];
    }
    return s2 === 0 ? 0 : s1 / s2;
  };
  return bars.map((_, i) => (i < p3 ? null : (100 * (4 * avg(i, p1) + 2 * avg(i, p2) + avg(i, p3))) / 7));
}

/** KDJ (popular on Asian exchanges): stochastic with 1/m smoothing and J = 3K - 2D. */
export function kdj(bars: Bar[], period: number, m1: number, m2: number) {
  const hh = highest(bars.map((b) => b.high), period);
  const ll = lowest(bars.map((b) => b.low), period);
  const k: Series = [];
  const d: Series = [];
  const j: Series = [];
  let kPrev = 50;
  let dPrev = 50;
  bars.forEach((b, i) => {
    if (hh[i] === null || ll[i] === null) {
      k.push(null);
      d.push(null);
      j.push(null);
      return;
    }
    const rsv = hh[i] === ll[i] ? 50 : (100 * (b.close - (ll[i] as number))) / ((hh[i] as number) - (ll[i] as number));
    kPrev = ((m1 - 1) * kPrev + rsv) / m1;
    dPrev = ((m2 - 1) * dPrev + kPrev) / m2;
    k.push(kPrev);
    d.push(dPrev);
    j.push(3 * kPrev - 2 * dPrev);
  });
  return { k, d, j };
}

export function aroon(bars: Bar[], period: number) {
  const up: Series = [];
  const down: Series = [];
  bars.forEach((_, i) => {
    if (i < period) {
      up.push(null);
      down.push(null);
      return;
    }
    let hi = i;
    let lo = i;
    for (let k = i - period; k <= i; k++) {
      if (bars[k].high >= bars[hi].high) hi = k;
      if (bars[k].low <= bars[lo].low) lo = k;
    }
    up.push((100 * (period - (i - hi))) / period);
    down.push((100 * (period - (i - lo))) / period);
  });
  return { up, down };
}

export function vortex(bars: Bar[], period: number) {
  const plus: Series = [];
  const minus: Series = [];
  const tr = trueRange(bars) as number[];
  bars.forEach((_, i) => {
    if (i < period) {
      plus.push(null);
      minus.push(null);
      return;
    }
    let vp = 0;
    let vm = 0;
    let t = 0;
    for (let k = i - period + 1; k <= i; k++) {
      vp += Math.abs(bars[k].high - bars[k - 1].low);
      vm += Math.abs(bars[k].low - bars[k - 1].high);
      t += tr[k];
    }
    plus.push(t ? vp / t : null);
    minus.push(t ? vm / t : null);
  });
  return { plus, minus };
}

/** Accumulation/Distribution line. */
export function adl(bars: Bar[]): Series {
  let acc = 0;
  return bars.map((b) => {
    acc += b.high === b.low ? 0 : ((b.close - b.low - (b.high - b.close)) / (b.high - b.low)) * b.volume;
    return acc;
  });
}

export function chaikinOscillator(bars: Bar[], fast: number, slow: number): Series {
  const a = adl(bars);
  return combine(ema(a, fast), ema(a, slow), (x, y) => x - y);
}

export function forceIndex(bars: Bar[], period: number): Series {
  return ema(bars.map((b, i) => (i === 0 ? null : (b.close - bars[i - 1].close) * b.volume)), period);
}

export function fisherTransform(bars: Bar[], period: number) {
  const m = hl2(bars);
  const hh = highest(m, period);
  const ll = lowest(m, period);
  const fisher: Series = [];
  let value = 0;
  let prevFish = 0;
  m.forEach((v, i) => {
    if (hh[i] === null || ll[i] === null || v === null) {
      fisher.push(null);
      return;
    }
    const range = (hh[i] as number) - (ll[i] as number);
    value = 0.66 * (range === 0 ? 0 : (v - (ll[i] as number)) / range - 0.5) + 0.67 * value;
    value = Math.max(-0.999, Math.min(0.999, value));
    prevFish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * prevFish;
    fisher.push(prevFish);
  });
  return { fisher, trigger: fisher.map((_, i) => (i === 0 ? null : fisher[i - 1])) };
}

/** Connors RSI: average of RSI, RSI of the up/down streak and percent rank of ROC(1). */
export function connorsRsi(values: Series, rsiLen: number, streakLen: number, rankLen: number): Series {
  const streak: Series = [];
  let s = 0;
  values.forEach((v, i) => {
    const prev = values[i - 1];
    if (i === 0 || v === null || prev === null || prev === undefined) {
      streak.push(i === 0 ? 0 : null);
      return;
    }
    s = v > prev ? (s > 0 ? s + 1 : 1) : v < prev ? (s < 0 ? s - 1 : -1) : 0;
    streak.push(s);
  });
  const r1 = rsi(values, rsiLen);
  const r2 = rsi(streak, streakLen);
  const ret = roc(values, 1);
  return values.map((_, i) => {
    if (r1[i] === null || r2[i] === null || i < rankLen || ret[i] === null) return null;
    let below = 0;
    for (let k = i - rankLen; k < i; k++) if (ret[k] !== null && (ret[k] as number) < (ret[i] as number)) below++;
    return ((r1[i] as number) + (r2[i] as number) + (100 * below) / rankLen) / 3;
  });
}

/** Schaff Trend Cycle: double stochastic of the MACD line. */
export function schaffTrendCycle(values: Series, cycle: number, fast: number, slow: number): Series {
  const m = combine(ema(values, fast), ema(values, slow), (a, b) => a - b);
  const stochSmooth = (src: Series): Series => {
    const hh = highest(src, cycle);
    const ll = lowest(src, cycle);
    let prev: number | null = null;
    return src.map((v, i) => {
      if (v === null || hh[i] === null || ll[i] === null) return null;
      const range = (hh[i] as number) - (ll[i] as number);
      const k = range > 0 ? (100 * (v - (ll[i] as number))) / range : (prev ?? 50);
      prev = prev === null ? k : prev + 0.5 * (k - prev);
      return prev;
    });
  };
  return stochSmooth(stochSmooth(m));
}

export function coppock(values: Series, wmaLen: number, longRoc: number, shortRoc: number): Series {
  return wma(combine(roc(values, longRoc), roc(values, shortRoc), (a, b) => a + b), wmaLen);
}

/** Know Sure Thing (Pring) with the standard 10/15/20/30 settings. */
export function kst(values: Series, signalLen: number) {
  const part = (r: number, s: number, w: number) => sma(roc(values, r), s).map((v) => (v === null ? null : v * w));
  const parts = [part(10, 10, 1), part(15, 10, 2), part(20, 10, 3), part(30, 15, 4)];
  const line = values.map((_, i) => (parts.some((p) => p[i] === null) ? null : parts.reduce((acc, p) => acc + (p[i] as number), 0)));
  return { kst: line, signal: sma(line, signalLen) };
}

/** Detrended Price Oscillator (centered, so the last period/2+1 bars are undefined). */
export function dpo(values: Series, period: number): Series {
  const avg = sma(values, period);
  const shift = Math.floor(period / 2) + 1;
  return values.map((v, i) => {
    const a = avg[i + shift];
    return v === null || a === null || a === undefined ? null : v - a;
  });
}

export function ppo(values: Series, fast: number, slow: number, signal: number) {
  const line = combine(ema(values, fast), ema(values, slow), (a, b) => (b === 0 ? 0 : (100 * (a - b)) / b));
  const sig = ema(line, signal);
  return { ppo: line, signal: sig, histogram: combine(line, sig, (a, b) => a - b) };
}

/** Klinger Oscillator as TradingView's built-in: signed volume by ta.change(hlc3) >= 0, EMA(34) − EMA(55), signal EMA(13). */
export function klinger(bars: Bar[], fast: number, slow: number, signal: number) {
  const vf: Series = bars.map((b, i) => {
    if (i === 0) return null;
    const p = bars[i - 1];
    const trend = b.high + b.low + b.close >= p.high + p.low + p.close ? 1 : -1;
    return trend * b.volume;
  });
  const kvo = combine(ema(vf, fast), ema(vf, slow), (a, b) => a - b);
  return { kvo, signal: ema(kvo, signal) };
}

export function easeOfMovement(bars: Bar[], period: number): Series {
  return sma(
    bars.map((b, i) => {
      if (i === 0 || b.volume === 0 || b.high === b.low) return null;
      const move = (b.high + b.low) / 2 - (bars[i - 1].high + bars[i - 1].low) / 2;
      return (move * (b.high - b.low) * 1e4) / b.volume;
    }),
    period,
  );
}

export function volumeOscillator(bars: Bar[], fast: number, slow: number): Series {
  const v = bars.map((b) => b.volume);
  return combine(ema(v, fast), ema(v, slow), (a, b) => (b === 0 ? 0 : (100 * (a - b)) / b));
}

export function pvt(bars: Bar[]): Series {
  let acc = 0;
  return bars.map((b, i) => {
    if (i > 0 && bars[i - 1].close !== 0) acc += ((b.close - bars[i - 1].close) / bars[i - 1].close) * b.volume;
    return acc;
  });
}

export function relativeVolume(bars: Bar[], period: number): Series {
  const avg = sma(bars.map((b) => b.volume), period);
  return bars.map((b, i) => (avg[i] ? b.volume / (avg[i] as number) : null));
}

export function percentB(values: Series, period: number, mult: number): Series {
  const bb = bollinger(values, period, mult);
  return values.map((v, i) => {
    const u = bb.upper[i];
    const l = bb.lower[i];
    return v === null || u === null || l === null || u === l ? null : (v - l) / (u - l);
  });
}

/** Annualised historical volatility in percent (crypto trades 365 days a year). */
export function historicalVolatility(bars: Bar[], period: number): Series {
  const logRet: Series = bars.map((b, i) => (i === 0 || bars[i - 1].close <= 0 ? null : Math.log(b.close / bars[i - 1].close)));
  const sd = stdev(logRet, period);
  const step = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 86400;
  const perYear = (365 * 86400) / Math.max(step, 1);
  return sd.map((v) => (v === null ? null : v * Math.sqrt(perYear) * 100));
}

export function choppiness(bars: Bar[], period: number): Series {
  const tr = trueRange(bars) as number[];
  return bars.map((_, i) => {
    if (i < period) return null;
    let sum = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - period + 1; k <= i; k++) {
      sum += tr[k];
      hi = Math.max(hi, bars[k].high);
      lo = Math.min(lo, bars[k].low);
    }
    return hi === lo ? null : (100 * Math.log10(sum / (hi - lo))) / Math.log10(period);
  });
}

// ---------------------------------------------------------------------------
// Order flow and volume profile
// ---------------------------------------------------------------------------

/** Buy volume: Binance taker-buy volume, otherwise estimated from the close's position in the range. */
export function buyVolume(b: Bar): number {
  if (b.buyVolume !== undefined && Number.isFinite(b.buyVolume)) return b.buyVolume;
  return b.high === b.low ? b.volume / 2 : (b.volume * (b.close - b.low)) / (b.high - b.low);
}

export const volumeDelta = (bars: Bar[]): Series => bars.map((b) => 2 * buyVolume(b) - b.volume);

/** Cumulative volume delta, reset at each UTC day when `daily` is set. */
export function cvd(bars: Bar[], daily: boolean): Series {
  let acc = 0;
  let day = -1;
  return bars.map((b) => {
    const d = Math.floor(b.time / 86400);
    if (daily && d !== day) {
      day = d;
      acc = 0;
    }
    acc += 2 * buyVolume(b) - b.volume;
    return acc;
  });
}

export interface ProfileRow {
  low: number;
  high: number;
  volume: number;
  buy: number;
  inValueArea: boolean;
}

export interface VolumeProfile {
  rows: ProfileRow[];
  poc: number;
  vah: number;
  val: number;
  fromIndex: number;
}

/** Volume profile of the last `lookback` bars, each bar's volume spread over the rows its range covers. */
export function volumeProfile(bars: Bar[], lookback: number, rowCount: number, valueAreaPct: number): VolumeProfile | null {
  const fromIndex = Math.max(0, bars.length - lookback);
  const win = bars.slice(fromIndex);
  if (win.length === 0) return null;
  const lo = Math.min(...win.map((b) => b.low));
  const hi = Math.max(...win.map((b) => b.high));
  if (!(hi > lo)) return null;
  const size = (hi - lo) / rowCount;
  const rows: ProfileRow[] = Array.from({ length: rowCount }, (_, r) => ({ low: lo + r * size, high: lo + (r + 1) * size, volume: 0, buy: 0, inValueArea: false }));
  for (const b of win) {
    const span = Math.max(b.high - b.low, size * 1e-6);
    const buyShare = b.volume > 0 ? buyVolume(b) / b.volume : 0.5;
    const first = Math.max(0, Math.floor((b.low - lo) / size));
    const last = Math.min(rowCount - 1, Math.floor((b.high - lo) / size));
    for (let r = first; r <= last; r++) {
      const overlap = b.high === b.low ? 1 : (Math.min(b.high, rows[r].high) - Math.max(b.low, rows[r].low)) / span;
      const v = b.volume * Math.max(0, overlap);
      rows[r].volume += v;
      rows[r].buy += v * buyShare;
    }
  }
  let pocRow = 0;
  rows.forEach((r, i) => {
    if (r.volume > rows[pocRow].volume) pocRow = i;
  });
  const total = rows.reduce((s, r) => s + r.volume, 0);
  let inside = rows[pocRow].volume;
  let up = pocRow;
  let down = pocRow;
  rows[pocRow].inValueArea = true;
  while (inside < (total * valueAreaPct) / 100 && (up < rowCount - 1 || down > 0)) {
    const nextUp = up < rowCount - 1 ? rows[up + 1].volume : -1;
    const nextDown = down > 0 ? rows[down - 1].volume : -1;
    if (nextUp >= nextDown) {
      up++;
      inside += rows[up].volume;
      rows[up].inValueArea = true;
    } else {
      down--;
      inside += rows[down].volume;
      rows[down].inValueArea = true;
    }
  }
  return {
    rows,
    poc: (rows[pocRow].low + rows[pocRow].high) / 2,
    vah: rows[up].high,
    val: rows[down].low,
    fromIndex,
  };
}
