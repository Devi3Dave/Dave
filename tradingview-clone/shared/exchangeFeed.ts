// Exchange prices from Twelve Data with the user's own API key: candles over REST and
// prices over a WebSocket, both callable straight from the browser (no server needed).
// API reference: https://twelvedata.com/docs (time_series, WebSocket /v1/quotes/price).
// Everything here is pure; the browser side lives in src/market/exchangeFeed.ts.

import type { Bar } from "./math.js";
import { aggregate, bucketTime, INTERVAL_SECONDS, isCalendarInterval } from "./marketData.js";

export const TWELVE_DATA_REST = "https://api.twelvedata.com";
export const TWELVE_DATA_WS = "wss://ws.twelvedata.com/v1/quotes/price";

export type FeedKind = "stock" | "index" | "forex";

export interface FeedSymbol {
  /** Ticker as Twelve Data names it (AAPL, SAP, SPX, EUR/USD). */
  symbol: string;
  /** Exchange code for listings outside the US (XETR = Xetra). */
  exchange?: string;
  kind: FeedKind;
}

// Twelve Data index tickers; the meta type of the answer must say "Index", so an ETF with the same ticker is never taken for the index.
const INDEX: Record<string, string> = {
  "^GSPC": "SPX",
  "^NDX": "NDX",
  "^DJI": "DJI",
  "^GDAXI": "DAX",
  "^STOXX50E": "SX5E",
  "^FTSE": "UKX",
  "^N225": "N225",
  "^VIX": "VIX",
};

/** Twelve Data symbol for a catalog id (Yahoo spelling), or null for what the feed does not cover (crypto, futures). */
export function feedSymbol(id: string): FeedSymbol | null {
  if (INDEX[id]) return { symbol: INDEX[id], kind: "index" };
  const fx = /^([A-Z]{3})([A-Z]{3})=X$/.exec(id);
  if (fx) return { symbol: `${fx[1]}/${fx[2]}`, kind: "forex" };
  const de = /^([A-Z0-9]{1,6})\.DE$/.exec(id);
  if (de) return { symbol: de[1], exchange: "XETR", kind: "stock" };
  // Plain US tickers (BRK.B style included); crypto pairs and Yahoo futures (=F) stay with their sources.
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(id) && !/USDT$/.test(id)) return { symbol: id, kind: "stock" };
  return null;
}

/** The WebSocket spelling: ticker:exchange outside the US. */
export function streamSymbol(s: FeedSymbol): string {
  return s.exchange ? `${s.symbol}:${s.exchange}` : s.symbol;
}

/** Twelve Data interval to request and whether the candles are merged into the chart's interval afterwards. */
export function feedInterval(interval: string): { interval: string; aggregate: boolean } {
  const direct: Record<string, string> = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1day", "1w": "1week", "1M": "1month", all: "1week" };
  if (direct[interval]) return { interval: direct[interval], aggregate: false };
  if (interval === "6h" || interval === "12h") return { interval: "1h", aggregate: true };
  if (isCalendarInterval(interval)) return { interval: "1month", aggregate: true };
  throw new Error(`Twelve Data unterstützt ${interval} nicht`);
}

/** time_series request; times come in UTC so they line up with the other sources. */
export function timeSeriesUrl(s: FeedSymbol, interval: string, limit: number, apiKey: string): string {
  const f = feedInterval(interval);
  const size = f.aggregate || interval === "all" ? 5000 : Math.min(5000, limit);
  const q = new URLSearchParams({ symbol: s.symbol, interval: f.interval, outputsize: String(size), timezone: "UTC", order: "ASC", apikey: apiKey });
  if (s.exchange) q.set("exchange", s.exchange);
  return `${TWELVE_DATA_REST}/time_series?${q}`;
}

interface TimeSeries {
  status?: string;
  code?: number;
  message?: string;
  meta?: { symbol?: string; type?: string; exchange?: string; mic_code?: string; exchange_timezone?: string };
  values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[];
}

export interface FeedSeries {
  bars: Bar[];
  /** Exchange named in the answer (NASDAQ, XETR …). */
  exchange: string | null;
}

/** "2026-10-26 14:30:00" or "2026-10-26" in UTC → unix seconds. */
function parseUtc(datetime: string): number {
  return Math.floor(Date.parse(`${datetime.replace(" ", "T")}${datetime.length > 10 ? "" : "T00:00:00"}Z`) / 1000);
}

/** Candles from a time_series answer; refuses errors and instruments of the wrong type. */
export function parseTimeSeries(json: TimeSeries, s: FeedSymbol, interval: string, limit: number): FeedSeries {
  if (json.status === "error" || !json.values) throw new Error(`Twelve Data: ${json.message ?? "keine Daten"}${json.code ? ` (${json.code})` : ""}`);
  const type = json.meta?.type ?? "";
  if (s.kind === "index" && !/index/i.test(type)) throw new Error(`Twelve Data: ${s.symbol} ist kein Index (${type || "Typ unbekannt"})`);
  if (s.kind === "forex" && type && !/currency|forex/i.test(type)) throw new Error(`Twelve Data: ${s.symbol} ist kein Währungspaar (${type})`);
  let bars: Bar[] = json.values
    .map((v) => ({ time: parseUtc(v.datetime), open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: v.volume ? +v.volume : 0 }))
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close));
  bars.sort((a, b) => a.time - b.time);
  if (feedInterval(interval).aggregate) bars = aggregate(bars, interval);
  return { bars: interval === "all" ? bars : bars.slice(-limit), exchange: json.meta?.exchange ?? null };
}

// ---------------- Live prices ----------------

export interface PriceEvent {
  symbol: string;
  price: number;
  /** Exchange time of the price, ms. */
  time: number;
  /** Volume of the day so far, where the exchange reports one. */
  dayVolume?: number;
}

export type StreamEvent = { kind: "price"; event: PriceEvent } | { kind: "status"; ok: string[]; failed: string[] } | { kind: "other" };

/** Parses one WebSocket message: price events and the answer to a subscription. */
export function parseStreamMessage(raw: string): StreamEvent {
  let msg: { event?: string; symbol?: string; price?: number | string; timestamp?: number; day_volume?: number | string; success?: { symbol: string }[]; fails?: { symbol: string }[] | null };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: "other" };
  }
  if (msg.event === "price" && msg.symbol && msg.price !== undefined && msg.timestamp) {
    const dayVolume = msg.day_volume === undefined ? undefined : +msg.day_volume;
    return { kind: "price", event: { symbol: msg.symbol, price: +msg.price, time: msg.timestamp * 1000, ...(Number.isFinite(dayVolume) ? { dayVolume } : {}) } };
  }
  if (msg.event === "subscribe-status") return { kind: "status", ok: (msg.success ?? []).map((x) => x.symbol), failed: (msg.fails ?? []).map((x) => x.symbol) };
  return { kind: "other" };
}

/** Start of the candle a live price belongs to, continuing the grid of the loaded candles (US hours start at :30). */
export function tickBucket(interval: string, time: number, last: Bar | undefined): number {
  const step = INTERVAL_SECONDS[interval] ?? 3600;
  if (isCalendarInterval(interval)) return bucketTime(interval, time);
  if (interval === "1w" || interval === "all") {
    const monday = 4 * 86400;
    return Math.floor((time - monday) / 604800) * 604800 + monday;
  }
  const offset = step < 86400 && last ? last.time % step : 0;
  return Math.floor((time - offset) / step) * step + offset;
}

/** Puts one live price into the candles: updates the forming candle or opens the next one. */
export function applyPrice(bars: Bar[], interval: string, price: number, timeMs: number, volume = 0): Bar[] {
  const last = bars[bars.length - 1];
  const time = tickBucket(interval, Math.floor(timeMs / 1000), last);
  if (last && time < last.time) return bars;
  const out = bars.slice();
  if (last && last.time === time) {
    out[out.length - 1] = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price, volume: last.volume + volume };
  } else {
    out.push({ time, open: price, high: price, low: price, close: price, volume });
  }
  return out;
}
