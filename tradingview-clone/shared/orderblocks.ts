import type { Bar } from "./math";

export interface OrderBlock {
  /** Time frame label, e.g. "1h", "4h", "1d". */
  tf: string;
  tfSeconds: number;
  side: "bull" | "bear";
  top: number;
  bottom: number;
  /** Time of the order-block candle (zone starts here). */
  from: number;
  /** Chart index from which the zone counts (after the break of structure closed). */
  activeIndex: number;
  /** Time the zone was invalidated (close through it), or null while it holds. */
  end: number | null;
  /** Box label; order blocks default to "OB <tf>". */
  label?: string;
  /** Dashed line at 50 % (FVG "consequential encroachment"). */
  mid?: boolean;
  /** Fixed box length: drawn only up to this time while the zone holds (null/absent = to the right edge). */
  until?: number;
}

export interface OrderBlockSignal {
  index: number;
  time: number;
  side: "buy" | "sell";
  tf: string;
  price: number;
}

export interface OrderBlockOptions {
  /** Pivot length (candles left and right) for swing highs/lows, on every time frame. */
  swing: number;
  /** Extra time frames in seconds (0 or ≤ chart interval = off). */
  higher: number[];
  /** Most recent zones per time frame and state that are returned. */
  maxZones: number;
  showBroken: boolean;
}

export function tfLabel(seconds: number): string {
  if (seconds % 604800 === 0) return `${seconds / 604800}w`;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

/** Typical spacing of the bars (median, robust against weekend gaps). */
export function barSeconds(bars: Bar[]): number {
  const d: number[] = [];
  for (let i = Math.max(1, bars.length - 50); i < bars.length; i++) d.push(bars[i].time - bars[i - 1].time);
  d.sort((a, b) => a - b);
  return d[d.length >> 1] ?? 60;
}

interface TfBar extends Bar {
  /** Index of the last chart bar inside this bucket. */
  last: number;
}

/** Completed higher-time-frame candles built from the chart bars (the running one is left out to avoid repainting). */
export function resample(bars: Bar[], seconds: number, keepForming = false): TfBar[] {
  const shift = seconds === 604800 ? 3 * 86400 : 0; // weeks start on Monday
  const out: TfBar[] = [];
  let key: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const k = Math.floor((b.time + shift) / seconds);
    const cur = out[out.length - 1];
    if (k !== key || !cur) {
      out.push({ time: k * seconds - shift, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, last: i });
      key = k;
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      cur.last = i;
    }
  }
  // The newest bucket is still forming unless the next chart bar would start a new one; dropped unless keepForming.
  const lastBar = bars[bars.length - 1];
  if (!keepForming && out.length && lastBar) {
    const step = barSeconds(bars);
    if (Math.floor((lastBar.time + step + shift) / seconds) === key) out.pop();
  }
  return out;
}

/**
 * Order blocks: when a close breaks the last swing high (bullish break of structure), the
 * candle with the lowest low between that swing and the break is the bullish order block –
 * mirrored for bearish ones. Zones stay valid until a close goes through them.
 * Source: smart-money-concepts `smc.ob` (joshyattridge/smart-money-concepts, MIT).
 */
function detect(src: TfBar[], swing: number, tf: string, tfSeconds: number): OrderBlock[] {
  const out: OrderBlock[] = [];
  let lastHigh: { idx: number; price: number } | null = null;
  let lastLow: { idx: number; price: number } | null = null;
  for (let j = 0; j < src.length; j++) {
    // A pivot at c is known once `swing` candles after it have closed.
    const c = j - swing;
    if (c >= swing) {
      let isHigh = true;
      let isLow = true;
      for (let k = c - swing; k <= c + swing; k++) {
        if (k === c) continue;
        // Ties count for the earlier candle (a plateau's first bar is the pivot).
        if (k < c ? src[k].high >= src[c].high : src[k].high > src[c].high) isHigh = false;
        if (k < c ? src[k].low <= src[c].low : src[k].low < src[c].low) isLow = false;
      }
      if (isHigh) lastHigh = { idx: c, price: src[c].high };
      if (isLow) lastLow = { idx: c, price: src[c].low };
    }
    const b = src[j];
    if (lastHigh && b.close > lastHigh.price) {
      let ob = lastHigh.idx;
      for (let k = lastHigh.idx; k < j; k++) if (src[k].low < src[ob].low) ob = k;
      out.push({ tf, tfSeconds, side: "bull", top: src[ob].high, bottom: src[ob].low, from: src[ob].time, activeIndex: b.last + 1, end: null });
      lastHigh = null;
    }
    if (lastLow && b.close < lastLow.price) {
      let ob = lastLow.idx;
      for (let k = lastLow.idx; k < j; k++) if (src[k].high > src[ob].high) ob = k;
      out.push({ tf, tfSeconds, side: "bear", top: src[ob].high, bottom: src[ob].low, from: src[ob].time, activeIndex: b.last + 1, end: null });
      lastLow = null;
    }
  }
  return out;
}

export function orderBlocks(bars: Bar[], opts: OrderBlockOptions): { zones: OrderBlock[]; signals: OrderBlockSignal[] } {
  const zones: OrderBlock[] = [];
  const signals: OrderBlockSignal[] = [];
  if (bars.length < opts.swing * 3) return { zones, signals };
  const step = barSeconds(bars);
  const frames = [step, ...opts.higher.filter((s) => s > step).sort((a, b) => a - b)].filter((s, i, a) => a.indexOf(s) === i);

  for (const seconds of frames) {
    const src: TfBar[] = seconds === step ? bars.map((b, i) => ({ ...b, last: i })) : resample(bars, seconds);
    const tf = tfLabel(seconds);
    const found = detect(src, opts.swing, tf, seconds);
    // Walk the chart candles after each zone became active: first retest = signal, close through = invalid.
    for (const z of found) {
      let signaled = false;
      for (let i = z.activeIndex; i < bars.length; i++) {
        const b = bars[i];
        if (z.side === "bull") {
          if (b.close < z.bottom) {
            z.end = b.time;
            break;
          }
          if (!signaled && b.low <= z.top && b.close > z.top && b.close > b.open) {
            signals.push({ index: i, time: b.time, side: "buy", tf, price: b.close });
            signaled = true;
          }
        } else {
          if (b.close > z.top) {
            z.end = b.time;
            break;
          }
          if (!signaled && b.high >= z.bottom && b.close < z.bottom && b.close < b.open) {
            signals.push({ index: i, time: b.time, side: "sell", tf, price: b.close });
            signaled = true;
          }
        }
      }
    }
    const active = found.filter((z) => z.end === null).slice(-opts.maxZones);
    const broken = opts.showBroken ? found.filter((z) => z.end !== null).slice(-opts.maxZones) : [];
    zones.push(...broken, ...active);
  }
  signals.sort((a, b) => a.index - b.index);
  return { zones, signals };
}
