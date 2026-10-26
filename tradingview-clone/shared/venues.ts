/**
 * Crypto exchanges besides Binance, written like TradingView's symbols: COINBASE:BTCUSD, KRAKEN:ETHEUR,
 * BYBIT:SOLUSDT … Every exchange here has public market data without a key: candles over REST and
 * trades over a WebSocket. A plain symbol (BTCUSDT) and BINANCE:BTCUSDT keep loading from Binance.
 *
 * Sources (official API documentation of each exchange):
 * - Coinbase Exchange: docs.cdp.coinbase.com/exchange (GET /products/{id}/candles; WebSocket channel "ticker")
 * - Kraken: docs.kraken.com/api (GET /0/public/OHLC; WebSocket v2 channel "trade")
 * - Bybit: bybit-exchange.github.io/docs/v5 (GET /v5/market/kline; topic publicTrade.{symbol})
 * - OKX: www.okx.com/docs-v5 (GET /api/v5/market/candles; channel "trades")
 * - Bitstamp: www.bitstamp.net/api (GET /api/v2/ohlc/{pair}/; channel live_trades_{pair})
 * - Bitfinex: docs.bitfinex.com (GET /v2/candles/trade:{tf}:{symbol}/hist; channel "trades")
 */
import type { Bar } from "./math.js";

export type VenueId = "BINANCE" | "COINBASE" | "KRAKEN" | "BYBIT" | "OKX" | "BITSTAMP" | "BITFINEX";

/** One trade from a venue's WebSocket. */
export interface VenueTrade {
  price: number;
  size: number;
  timeMs: number;
}

export interface Venue {
  id: VenueId;
  name: string;
  /** Quote a USDT pair from Binance becomes on this exchange (Coinbase and Kraken trade BTC mostly against USD). */
  defaultQuote: string;
  /** Our time frame → the exchange's candle code. */
  intervals: Record<string, string>;
  /** Most candles per request. */
  maxLimit: number;
  /** Older candles can be requested (endTime); Kraken only serves its newest 720. */
  paging: boolean;
  /** REST URL for candles; `endSec` (exclusive) pages back. */
  candlesUrl(pair: VenuePair, code: string, limit: number, endSec?: number, stepSec?: number): string;
  /** Candles in ascending time; throws the exchange's error text. */
  parseCandles(json: unknown): Bar[];
  wsUrl: string;
  subscribe(pair: VenuePair): string;
  /** Message to keep the connection open, and how often. */
  ping?: { everyMs: number; message: string };
  parseTrades(msg: unknown): VenueTrade[];
}

export interface VenuePair {
  base: string;
  quote: string;
}

// Longest first: USDT before USD.
const QUOTES = ["FDUSD", "USDT", "USDC", "USD", "EUR", "GBP", "JPY", "TRY", "BTC", "ETH"];

/** BTCUSDT → BTC / USDT; null when no known quote currency ends the symbol. */
export function splitPair(symbol: string): VenuePair | null {
  const s = symbol.toUpperCase().replace(/[-/_]/g, "");
  for (const quote of QUOTES) if (s.length > quote.length + 1 && s.endsWith(quote)) return { base: s.slice(0, -quote.length), quote };
  return null;
}

const num = (v: unknown) => Number(v);
const fail = (venue: string, text: string): never => {
  throw new Error(`${venue}: ${text}`);
};

const coinbase: Venue = {
  id: "COINBASE",
  name: "Coinbase",
  defaultQuote: "USD",
  intervals: { "1m": "60", "5m": "300", "15m": "900", "1h": "3600", "6h": "21600", "1d": "86400" },
  maxLimit: 300,
  paging: true,
  candlesUrl(p, code, limit, endSec) {
    const base = `https://api.exchange.coinbase.com/products/${p.base}-${p.quote}/candles?granularity=${code}`;
    // Coinbase pages only with both start and end.
    if (!endSec) return base;
    const start = endSec - limit * Number(code);
    return `${base}&start=${new Date(start * 1000).toISOString()}&end=${new Date((endSec - 1) * 1000).toISOString()}`;
  },
  parseCandles(json) {
    if (!Array.isArray(json)) return fail("Coinbase", (json as { message?: string })?.message ?? "keine Kerzen");
    // [time, low, high, open, close, volume], newest first.
    return (json as unknown[][]).map((r) => ({ time: num(r[0]), low: num(r[1]), high: num(r[2]), open: num(r[3]), close: num(r[4]), volume: num(r[5]) })).reverse();
  },
  wsUrl: "wss://ws-feed.exchange.coinbase.com",
  subscribe: (p) => JSON.stringify({ type: "subscribe", product_ids: [`${p.base}-${p.quote}`], channels: ["ticker"] }),
  parseTrades(msg) {
    const m = msg as { type?: string; price?: string; last_size?: string; time?: string };
    return m.type === "ticker" && m.price ? [{ price: num(m.price), size: num(m.last_size ?? 0), timeMs: m.time ? Date.parse(m.time) : Date.now() }] : [];
  },
};

/** Kraken's REST names: XBT for Bitcoin, XDG for Dogecoin. */
const krakenAsset = (a: string) => (a === "BTC" ? "XBT" : a === "DOGE" ? "XDG" : a);

const kraken: Venue = {
  id: "KRAKEN",
  name: "Kraken",
  defaultQuote: "USD",
  intervals: { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "1440", "1w": "10080" },
  maxLimit: 720,
  paging: false,
  candlesUrl: (p, code) => `https://api.kraken.com/0/public/OHLC?pair=${krakenAsset(p.base)}${krakenAsset(p.quote)}&interval=${code}`,
  parseCandles(json) {
    const j = json as { error?: string[]; result?: Record<string, unknown> };
    if (j.error?.length) fail("Kraken", j.error.join(", "));
    const key = Object.keys(j.result ?? {}).find((k) => k !== "last");
    const rows = (key ? j.result![key] : []) as unknown[][];
    // [time, open, high, low, close, vwap, volume, count], oldest first.
    return rows.map((r) => ({ time: num(r[0]), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[6]) }));
  },
  wsUrl: "wss://ws.kraken.com/v2",
  subscribe: (p) => JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: [`${p.base}/${p.quote}`], snapshot: false } }),
  parseTrades(msg) {
    const m = msg as { channel?: string; type?: string; data?: { price: number; qty: number; timestamp: string }[] };
    if (m.channel !== "trade" || m.type !== "update" || !Array.isArray(m.data)) return [];
    return m.data.map((t) => ({ price: num(t.price), size: num(t.qty), timeMs: Date.parse(t.timestamp) }));
  },
};

const bybit: Venue = {
  id: "BYBIT",
  name: "Bybit",
  defaultQuote: "USDT",
  intervals: { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720", "1d": "D", "1w": "W", "1M": "M" },
  maxLimit: 1000,
  paging: true,
  candlesUrl: (p, code, limit, endSec) =>
    `https://api.bybit.com/v5/market/kline?category=spot&symbol=${p.base}${p.quote}&interval=${code}&limit=${limit}${endSec ? `&end=${endSec * 1000 - 1}` : ""}`,
  parseCandles(json) {
    const j = json as { retCode?: number; retMsg?: string; result?: { list?: unknown[][] } };
    if (j.retCode !== 0) fail("Bybit", j.retMsg ?? "Fehler");
    // [start ms, open, high, low, close, volume, turnover], newest first.
    return (j.result?.list ?? []).map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) })).reverse();
  },
  wsUrl: "wss://stream.bybit.com/v5/public/spot",
  subscribe: (p) => JSON.stringify({ op: "subscribe", args: [`publicTrade.${p.base}${p.quote}`] }),
  // Bybit closes connections that send nothing for a while; it asks for a ping every 20 s.
  ping: { everyMs: 20_000, message: JSON.stringify({ op: "ping" }) },
  parseTrades(msg) {
    const m = msg as { topic?: string; data?: { T: number; p: string; v: string }[] };
    if (!m.topic?.startsWith("publicTrade.") || !Array.isArray(m.data)) return [];
    return m.data.map((t) => ({ price: num(t.p), size: num(t.v), timeMs: num(t.T) }));
  },
};

const okx: Venue = {
  id: "OKX",
  name: "OKX",
  defaultQuote: "USDT",
  // From 6 h on OKX counts in Hong Kong time unless the code ends in "utc".
  intervals: { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6Hutc", "12h": "12Hutc", "1d": "1Dutc", "1w": "1Wutc", "1M": "1Mutc" },
  maxLimit: 300,
  paging: true,
  candlesUrl: (p, code, limit, endSec) => `https://www.okx.com/api/v5/market/candles?instId=${p.base}-${p.quote}&bar=${code}&limit=${limit}${endSec ? `&after=${endSec * 1000}` : ""}`,
  parseCandles(json) {
    const j = json as { code?: string; msg?: string; data?: unknown[][] };
    if (j.code !== "0") fail("OKX", j.msg || "Fehler");
    // [ts, open, high, low, close, volume, …], newest first.
    return (j.data ?? []).map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) })).reverse();
  },
  wsUrl: "wss://ws.okx.com:8443/ws/v5/public",
  subscribe: (p) => JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: `${p.base}-${p.quote}` }] }),
  // OKX drops a connection after 30 s without traffic; "ping" is answered with "pong".
  ping: { everyMs: 25_000, message: "ping" },
  parseTrades(msg) {
    const m = msg as { arg?: { channel?: string }; data?: { px: string; sz: string; ts: string }[] };
    if (m.arg?.channel !== "trades" || !Array.isArray(m.data)) return [];
    return m.data.map((t) => ({ price: num(t.px), size: num(t.sz), timeMs: num(t.ts) }));
  },
};

const bitstamp: Venue = {
  id: "BITSTAMP",
  name: "Bitstamp",
  defaultQuote: "USD",
  intervals: { "1m": "60", "3m": "180", "5m": "300", "15m": "900", "30m": "1800", "1h": "3600", "2h": "7200", "4h": "14400", "6h": "21600", "12h": "43200", "1d": "86400", "3d": "259200" },
  maxLimit: 1000,
  paging: true,
  candlesUrl: (p, code, limit, endSec) =>
    `https://www.bitstamp.net/api/v2/ohlc/${(p.base + p.quote).toLowerCase()}/?step=${code}&limit=${limit}${endSec ? `&end=${endSec - 1}` : ""}`,
  parseCandles(json) {
    const j = json as { data?: { ohlc?: Record<string, string>[] }; errors?: { message?: string }[]; message?: string };
    if (!j.data?.ohlc) fail("Bitstamp", j.errors?.[0]?.message ?? j.message ?? "Paar nicht gefunden");
    return j.data!.ohlc!.map((r) => ({ time: num(r.timestamp), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume) }));
  },
  wsUrl: "wss://ws.bitstamp.net",
  subscribe: (p) => JSON.stringify({ event: "bts:subscribe", data: { channel: `live_trades_${(p.base + p.quote).toLowerCase()}` } }),
  parseTrades(msg) {
    const m = msg as { event?: string; data?: { price: number; amount: number; microtimestamp?: string; timestamp?: string } };
    if (m.event !== "trade" || !m.data) return [];
    const timeMs = m.data.microtimestamp ? Math.floor(num(m.data.microtimestamp) / 1000) : num(m.data.timestamp) * 1000;
    return [{ price: num(m.data.price), size: num(m.data.amount), timeMs }];
  },
};

/** Bitfinex writes USDT as UST and puts a colon into longer names (tBTCUSD, tDOGE:USD). */
function bitfinexSymbol(p: VenuePair): string {
  const quote = p.quote === "USDT" ? "UST" : p.quote;
  return `t${p.base}${p.base.length > 3 || quote.length > 3 ? ":" : ""}${quote}`;
}

const bitfinex: Venue = {
  id: "BITFINEX",
  name: "Bitfinex",
  defaultQuote: "USD",
  intervals: { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "3h": "3h", "6h": "6h", "12h": "12h", "1d": "1D", "1w": "1W", "1M": "1M" },
  maxLimit: 1000,
  paging: true,
  candlesUrl: (p, code, limit, endSec) =>
    `https://api-pub.bitfinex.com/v2/candles/trade:${code}:${bitfinexSymbol(p)}/hist?limit=${limit}&sort=-1${endSec ? `&end=${endSec * 1000 - 1}` : ""}`,
  parseCandles(json) {
    if (!Array.isArray(json) || json[0] === "error") fail("Bitfinex", Array.isArray(json) ? String(json[2] ?? "Fehler") : "keine Kerzen");
    // [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME], newest first (sort=-1).
    return (json as number[][]).map((r) => ({ time: Math.floor(r[0] / 1000), open: r[1], close: r[2], high: r[3], low: r[4], volume: r[5] })).reverse();
  },
  wsUrl: "wss://api-pub.bitfinex.com/ws/2",
  subscribe: (p) => JSON.stringify({ event: "subscribe", channel: "trades", symbol: bitfinexSymbol(p) }),
  parseTrades(msg) {
    // [chanId, "te", [ID, MTS, AMOUNT, PRICE]]; "tu" repeats the trade, snapshots and heartbeats are skipped.
    if (!Array.isArray(msg) || msg[1] !== "te" || !Array.isArray(msg[2])) return [];
    const [, mts, amount, price] = msg[2] as number[];
    return [{ price, size: Math.abs(amount), timeMs: mts }];
  },
};

/** Binance is listed for the picker only; its data keeps coming from shared/marketData.ts. */
export const VENUES: { id: VenueId; name: string }[] = [
  { id: "BINANCE", name: "Binance" },
  ...[coinbase, kraken, bybit, okx, bitstamp, bitfinex].map((v) => ({ id: v.id, name: v.name })),
];

const BY_ID: Partial<Record<VenueId, Venue>> = { COINBASE: coinbase, KRAKEN: kraken, BYBIT: bybit, OKX: okx, BITSTAMP: bitstamp, BITFINEX: bitfinex };

export function getVenue(id: string): Venue | undefined {
  return BY_ID[id.toUpperCase() as VenueId];
}

export function venueName(id: string): string {
  return VENUES.find((v) => v.id === id.toUpperCase())?.name ?? id;
}

export interface VenueSymbol {
  venue: Venue;
  pair: VenuePair;
}

/** COINBASE:BTCUSD → Coinbase, BTC / USD; null for plain symbols and BINANCE:… */
export function parseVenueSymbol(symbol: string): VenueSymbol | null {
  const m = /^([A-Z]+):([A-Z0-9-/_]+)$/i.exec(symbol.trim());
  const venue = m && getVenue(m[1]);
  const pair = m && splitPair(m[2]);
  return venue && pair ? { venue, pair } : null;
}

/** BINANCE:BTCUSDT → BTCUSDT: Binance symbols stay plain, as everywhere else in the app. */
export function stripBinance(symbol: string): string {
  return symbol.replace(/^BINANCE:/i, "");
}

/** The plain pair behind a symbol (COINBASE:BTCUSD → BTCUSD). */
export function plainSymbol(symbol: string): string {
  return symbol.replace(/^[A-Z]+:/i, "");
}

/**
 * The symbol for a Binance pair on another exchange: USDT pairs take the exchange's usual quote
 * (BTCUSDT → COINBASE:BTCUSD), other quotes stay (ETHBTC → KRAKEN:ETHBTC).
 */
export function venueSymbol(venueId: string, binanceSymbol: string): string {
  const plain = plainSymbol(binanceSymbol);
  if (venueId === "BINANCE") return plain;
  const venue = getVenue(venueId);
  const pair = splitPair(plain);
  if (!venue || !pair) return plain;
  return `${venue.id}:${pair.base}${pair.quote === "USDT" ? venue.defaultQuote : pair.quote}`;
}
