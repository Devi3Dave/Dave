/**
 * Tick and range intervals like the "Ticks" and "Bereiche" groups of TradingView's interval menu: bars that
 * close after a number of trades or after a price range instead of after a time.
 *
 * Sources:
 * - Ticks: TradingView Pine Script docs, "Timeframes" (tradingview.com/pine-script-docs/concepts/timeframes/):
 *   tick-based timeframes are written like "10T" (timeframe.isticks); TradingView help "Time intervals"
 *   (support 43000747934): a tick bar is finished after that many trades (1T, 10T, 100T, 1000T).
 * - Ranges: TradingView help "Understanding range charts" (support 43000474007): one range is one minimum
 *   price change (mintick), so 100 ranges are bars that span 100 × mintick from low to high; a new bar opens
 *   where the last one closed. Written here as "100R".
 * - Trades: Binance spot API "Compressed/Aggregate trades list" (GET /api/v3/aggTrades) and the WebSocket stream
 *   "<symbol>@aggTrade" (developers.binance.com/docs/binance-spot-api-docs): an aggregate trade groups the
 *   trades of one taker order at one price with trade ids f … l, so it counts as l − f + 1 ticks; m = true
 *   means the buyer was the maker, i.e. a taker sell. Tick size: PRICE_FILTER.tickSize of /api/v3/exchangeInfo.
 */
import type { Bar } from "./math.js";

export interface Trade {
  /** Exchange time in ms. */
  timeMs: number;
  price: number;
  qty: number;
  /** Trades in this (aggregate) trade, at least 1. */
  count: number;
  /** Taker bought (Binance m = false). */
  buy?: boolean;
}

export interface TradeInterval {
  kind: "ticks" | "range";
  count: number;
}

/** Tick bars carry how many trades they hold, so a live trade knows whether the last bar is full. */
type TradeBar = Bar & { ticks?: number };

const TRADE_INTERVAL = /^([1-9]\d{0,3})(T|R)$/;

/** "100T" → 100 trades per bar, "10R" → 10 × tick size per bar; null for time intervals. */
export function parseTradeInterval(interval: string): TradeInterval | null {
  const m = TRADE_INTERVAL.exec(interval);
  return m ? { kind: m[2] === "T" ? "ticks" : "range", count: Number(m[1]) } : null;
}

export const isTradeInterval = (interval: string) => parseTradeInterval(interval) !== null;

/** Typed text like "50T", "50 Ticks", "25R" or "25 Bereiche" → "50T" / "25R". */
export function normalizeTradeInterval(raw: string): string | null {
  const m = /^\s*(\d+)\s*(T|R|ticks?|bereiche?|ranges?)\s*$/i.exec(raw);
  if (!m) return null;
  const unit = m[2];
  // A lowercase t alone stays "Tage" (normalizeInterval); only T or the word means ticks.
  if (unit === "t" || unit === "r") return null;
  const iv = `${Number(m[1])}${/^t/i.test(unit) ? "T" : "R"}`;
  return isTradeInterval(iv) ? iv : null;
}

/**
 * Bar times stay unique and ordered for the chart: the trade's time in ms, or 1 ms after the last bar when
 * several bars start in the same millisecond. Times are seconds with a fraction (lightweight-charts accepts any number).
 */
function nextTime(last: Bar | undefined, timeMs: number): number {
  return last ? Math.max(timeMs, Math.round(last.time * 1000) + 1) / 1000 : timeMs / 1000;
}

/**
 * Adds trades to tick or range bars and returns the new list; `bars` itself is not changed.
 * `tickSize` is the symbol's minimum price change (only used for ranges).
 */
export function addTrades(bars: Bar[], spec: TradeInterval, tickSize: number, trades: Trade[]): Bar[] {
  const out: TradeBar[] = bars.slice();
  if (out.length) out[out.length - 1] = { ...out[out.length - 1] };
  const open = (timeMs: number, price: number): TradeBar => {
    const bar: TradeBar = { time: nextTime(out[out.length - 1], timeMs), open: price, high: price, low: price, close: price, volume: 0, buyVolume: 0, ticks: 0 };
    out.push(bar);
    return bar;
  };
  const range = spec.count * tickSize;
  const eps = range * 1e-9;
  for (const t of trades) {
    if (!(t.price > 0) || !Number.isFinite(t.timeMs)) continue;
    const count = Math.max(1, Math.round(t.count));
    if (spec.kind === "ticks") {
      // An aggregate trade can fill one bar and start the next; its volume is split by trades.
      let left = count;
      while (left > 0) {
        let c = out[out.length - 1];
        if (!c || (c.ticks ?? spec.count) >= spec.count) c = open(t.timeMs, t.price);
        const take = Math.min(left, spec.count - (c.ticks ?? 0));
        const share = take / count;
        c.ticks = (c.ticks ?? 0) + take;
        c.high = Math.max(c.high, t.price);
        c.low = Math.min(c.low, t.price);
        c.close = t.price;
        c.volume += t.qty * share;
        if (t.buy) c.buyVolume = (c.buyVolume ?? 0) + t.qty * share;
        left -= take;
      }
    } else {
      let c = out[out.length - 1] ?? open(t.timeMs, t.price);
      // A jump over several ranges fills the bars in between, as TradingView and TradeStation draw them.
      for (;;) {
        if (t.price > c.low + range + eps) {
          c.high = c.close = c.low + range;
          c = open(t.timeMs, c.close);
        } else if (t.price < c.high - range - eps) {
          c.low = c.close = c.high - range;
          c = open(t.timeMs, c.close);
        } else {
          c.high = Math.max(c.high, t.price);
          c.low = Math.min(c.low, t.price);
          c.close = t.price;
          break;
        }
      }
      c.volume += t.qty;
      if (t.buy) c.buyVolume = (c.buyVolume ?? 0) + t.qty;
      c.ticks = (c.ticks ?? 0) + count;
    }
  }
  return out;
}

/** Smallest price step seen in the prices: 10^-decimals (fallback when the exchange does not say). */
export function tickSizeFromPrices(prices: number[]): number {
  let decimals = 0;
  for (const p of prices) {
    const s = String(p);
    const dot = s.indexOf(".");
    if (dot >= 0 && !s.includes("e")) decimals = Math.max(decimals, s.length - dot - 1);
  }
  return Number((10 ** -decimals).toFixed(decimals));
}

/** Most bars kept in a live tick or range chart; older ones scroll out. */
export const MAX_TRADE_BARS = 5000;

/** Random-walk trades for offline demo charts (deterministic per symbol), ending now. */
export function demoTrades(symbol: string, n: number): Trade[] {
  let seed = [...symbol].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const trades: Trade[] = [];
  let price = 50 + Math.round(rand() * 45000) / 100;
  let time = Date.now() - n * 250;
  for (let i = 0; i < n; i++) {
    time += Math.round(rand() * 500);
    price = Math.max(0.01, Math.round((price + (rand() - 0.5) * price * 0.0008) * 100) / 100);
    trades.push({ timeMs: time, price, qty: Math.round(rand() * 1000) / 100 + 0.01, count: 1 + Math.floor(rand() * 3), buy: rand() < 0.5 });
  }
  return trades;
}
