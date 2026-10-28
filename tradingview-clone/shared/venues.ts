/**
 * Crypto markets of several exchanges, written like TradingView's symbols:
 * - Spot: COINBASE:BTCUSD, KRAKEN:ETHEUR, BYBIT:SOLUSDT …
 * - Perpetuals with ".P": BINANCE:BTCUSDT.P (USDⓈ-M), BINANCE:BTCUSD.P (COIN-M), BYBIT:BTCUSDT.P, OKX:BTCUSDT.P,
 *   KRAKEN:BTCUSD.P, BITFINEX:BTCUSDT.P
 * - Futures with an expiry under the exchange's own name: BINANCE:BTCUSDT_260327, OKX:BTC-USD-260327,
 *   BYBIT:BTCUSDT-27MAR26, BYBIT:BTCUSDH26, KRAKEN:FF_XBTUSD_260327
 * Every market here has public data without a key: candles over REST and trades over a WebSocket. A plain
 * symbol (BTCUSDT) and BINANCE:BTCUSDT keep loading Binance spot through shared/marketData.ts.
 *
 * Sources (official API documentation of each exchange):
 * - Binance: developers.binance.com (USDⓈ-M /fapi/v1/klines, COIN-M /dapi/v1/klines, stream <symbol>@aggTrade)
 * - Coinbase Exchange: docs.cdp.coinbase.com/exchange (GET /products/{id}/candles; WebSocket channel "ticker")
 * - Kraken: docs.kraken.com/api (spot GET /0/public/OHLC, WebSocket v2 "trade"; futures charts
 *   /api/charts/v1/trade/{symbol}/{resolution}, WebSocket v1 feed "trade")
 * - Bybit: bybit-exchange.github.io/docs/v5 (GET /v5/market/kline with category spot/linear/inverse; publicTrade.{symbol})
 * - OKX: www.okx.com/docs-v5 (GET /api/v5/market/candles for SPOT, SWAP and FUTURES instIds; channel "trades")
 * - Bitstamp: www.bitstamp.net/api (GET /api/v2/ohlc/{pair}/; channel live_trades_{pair})
 * - Bitfinex: docs.bitfinex.com (GET /v2/candles/trade:{tf}:{symbol}/hist; perpetuals tBTCF0:USTF0; channel "trades")
 */
import type { Bar } from "./math.js";

export type VenueId = "BINANCE" | "COINBASE" | "KRAKEN" | "BYBIT" | "OKX" | "BITSTAMP" | "BITFINEX";
export type MarketKind = "spot" | "perp" | "future";

/** One trade from a venue's WebSocket. */
export interface VenueTrade {
  price: number;
  size: number;
  timeMs: number;
}

/** One API family of an exchange: how to ask for candles and trades of its instruments. */
export interface Feed {
  /** Our time frame → the exchange's candle code. */
  intervals: Record<string, string>;
  /** Most candles per request. */
  maxLimit: number;
  /** Older candles can be requested (endTime); Kraken spot only serves its newest 720. */
  paging: boolean;
  /** REST URL for candles of the exchange's instrument id; `endSec` (exclusive) pages back. */
  candlesUrl(native: string, code: string, limit: number, endSec?: number): string;
  /** Candles in ascending time; throws the exchange's error text. */
  parseCandles(json: unknown): Bar[];
  wsUrl: string;
  subscribe(native: string): string;
  /** Message to keep the connection open, and how often. */
  ping?: { everyMs: number; message: string };
  parseTrades(msg: unknown): VenueTrade[];
}

export interface VenuePair {
  base: string;
  quote: string;
}

/** A market resolved from a symbol: which feed loads it and under which instrument id. */
export interface Instrument {
  venue: Venue;
  kind: MarketKind;
  pair: VenuePair;
  /** Instrument id for REST candles. */
  native: string;
  /** Instrument id on the WebSocket, when it differs (Kraken spot: BTC/USD against XBTUSD). */
  wsNative?: string;
  /** Inverse (coin-margined) contract: priced in USD, settled in the coin. */
  inverse?: boolean;
  feed: Feed;
}

export interface Venue {
  id: VenueId;
  name: string;
  /** Quote a USDT pair from Binance becomes on this exchange's spot market (Coinbase and Kraken trade BTC mostly against USD). */
  defaultQuote: string;
  /** Quote of the usual perpetual (BTCUSDT.P); none for exchanges without public perpetuals. */
  perpQuote?: string;
  /** The market behind the part of a symbol after "VENUE:", or null if this exchange has no such market. */
  resolve(rest: string): Instrument | null;
}

// Longest first: USDT before USD. Stablecoins and fiat that exchanges quote against.
const QUOTES = ["FDUSD", "PYUSD", "RLUSD", "USDT", "USDC", "USDE", "EURC", "TUSD", "USD", "DAI", "EUR", "GBP", "JPY", "TRY", "AUD", "CAD", "CHF", "BRL", "BTC", "ETH"];

/** BTCUSDT → BTC / USDT; null when no known quote currency ends the symbol. */
export function splitPair(symbol: string): VenuePair | null {
  const s = symbol.toUpperCase().replace(/[-/_]/g, "");
  if (!/^[A-Z0-9]+$/.test(s)) return null;
  for (const quote of QUOTES) if (s.length > quote.length + 1 && s.endsWith(quote)) return { base: s.slice(0, -quote.length), quote };
  return null;
}

const num = (v: unknown) => Number(v);
const fail = (venue: string, text: string): never => {
  throw new Error(`${venue}: ${text}`);
};
const PERP = /^([A-Z0-9]+)\.P$/;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Binance-style klines rows: [open time ms, open, high, low, close, volume, …], oldest first. */
function klineRows(venue: string, json: unknown): Bar[] {
  if (!Array.isArray(json)) return fail(venue, (json as { msg?: string })?.msg ?? "keine Kerzen");
  return (json as unknown[][]).map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) }));
}

// ---------------- Binance derivatives (spot stays in shared/marketData.ts) ----------------

const BINANCE_INTERVALS = Object.fromEntries(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"].map((i) => [i, i]));

function binanceFeed(rest: string, ws: string): Feed {
  return {
    intervals: BINANCE_INTERVALS,
    maxLimit: 1000,
    paging: true,
    candlesUrl: (native, code, limit, endSec) => `${rest}?symbol=${native}&interval=${code}&limit=${limit}${endSec ? `&endTime=${endSec * 1000 - 1}` : ""}`,
    parseCandles: (json) => klineRows("Binance", json),
    wsUrl: ws,
    subscribe: (native) => JSON.stringify({ method: "SUBSCRIBE", params: [`${native.toLowerCase()}@aggTrade`], id: 1 }),
    parseTrades(msg) {
      const m = msg as { e?: string; p?: string; q?: string; T?: number };
      return m.e === "aggTrade" ? [{ price: num(m.p), size: num(m.q), timeMs: num(m.T) }] : [];
    },
  };
}

const binanceUsdm = binanceFeed("https://fapi.binance.com/fapi/v1/klines", "wss://fstream.binance.com/ws");
const binanceCoinm = binanceFeed("https://dapi.binance.com/dapi/v1/klines", "wss://dstream.binance.com/ws");

const binance: Venue = {
  id: "BINANCE",
  name: "Binance",
  defaultQuote: "USDT",
  perpQuote: "USDT",
  resolve(rest) {
    // COIN-M: BTCUSD.P → BTCUSD_PERP, BTCUSD_260327; USDⓈ-M: BTCUSDT.P → BTCUSDT, BTCUSDT_260327.
    const perp = PERP.exec(rest);
    const dated = /^([A-Z0-9]+)_(\d{6})$/.exec(rest);
    const pair = splitPair(perp?.[1] ?? dated?.[1] ?? "");
    if (!pair || (!perp && !dated)) return null;
    const inverse = pair.quote === "USD";
    const base = { venue: binance, pair, inverse, feed: inverse ? binanceCoinm : binanceUsdm };
    if (perp) return { ...base, kind: "perp", native: inverse ? `${pair.base}USD_PERP` : `${pair.base}${pair.quote}` };
    return { ...base, kind: "future", native: rest };
  },
};

// ---------------- Coinbase ----------------

const coinbaseFeed: Feed = {
  intervals: { "1m": "60", "5m": "300", "15m": "900", "1h": "3600", "6h": "21600", "1d": "86400" },
  maxLimit: 300,
  paging: true,
  candlesUrl(native, code, limit, endSec) {
    const base = `https://api.exchange.coinbase.com/products/${native}/candles?granularity=${code}`;
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
  subscribe: (native) => JSON.stringify({ type: "subscribe", product_ids: [native], channels: ["ticker"] }),
  parseTrades(msg) {
    const m = msg as { type?: string; price?: string; last_size?: string; time?: string };
    return m.type === "ticker" && m.price ? [{ price: num(m.price), size: num(m.last_size ?? 0), timeMs: m.time ? Date.parse(m.time) : Date.now() }] : [];
  },
};

const coinbase: Venue = {
  id: "COINBASE",
  name: "Coinbase",
  defaultQuote: "USD",
  resolve(rest) {
    const pair = splitPair(rest);
    return pair && /^[A-Z0-9]+$/.test(rest) ? { venue: coinbase, kind: "spot", pair, native: `${pair.base}-${pair.quote}`, feed: coinbaseFeed } : null;
  },
};

// ---------------- Kraken ----------------

/** Kraken's REST names: XBT for Bitcoin, XDG for Dogecoin. */
const krakenAsset = (a: string) => (a === "BTC" ? "XBT" : a === "DOGE" ? "XDG" : a);
/** And back: XBT → BTC. */
export const krakenCoin = (a: string) => (a === "XBT" ? "BTC" : a === "XDG" ? "DOGE" : a);

const krakenSpot: Feed = {
  intervals: { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "1440", "1w": "10080" },
  maxLimit: 720,
  paging: false,
  candlesUrl: (native, code) => `https://api.kraken.com/0/public/OHLC?pair=${native}&interval=${code}`,
  parseCandles(json) {
    const j = json as { error?: string[]; result?: Record<string, unknown> };
    if (j.error?.length) fail("Kraken", j.error.join(", "));
    const key = Object.keys(j.result ?? {}).find((k) => k !== "last");
    const rows = (key ? j.result![key] : []) as unknown[][];
    // [time, open, high, low, close, vwap, volume, count], oldest first.
    return rows.map((r) => ({ time: num(r[0]), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[6]) }));
  },
  wsUrl: "wss://ws.kraken.com/v2",
  subscribe: (native) => JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: [native], snapshot: false } }),
  parseTrades(msg) {
    const m = msg as { channel?: string; type?: string; data?: { price: number; qty: number; timestamp: string }[] };
    if (m.channel !== "trade" || m.type !== "update" || !Array.isArray(m.data)) return [];
    return m.data.map((t) => ({ price: num(t.price), size: num(t.qty), timeMs: Date.parse(t.timestamp) }));
  },
};

const KRAKEN_FUTURES_STEP: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "12h": 43200, "1d": 86400, "1w": 604800 };

const krakenFutures: Feed = {
  intervals: Object.fromEntries(Object.keys(KRAKEN_FUTURES_STEP).map((i) => [i, i])),
  maxLimit: 2000,
  paging: true,
  candlesUrl(native, code, limit, endSec) {
    const to = endSec ? endSec - 1 : Math.floor(Date.now() / 1000);
    return `https://futures.kraken.com/api/charts/v1/trade/${native}/${code}?from=${to - limit * KRAKEN_FUTURES_STEP[code]}&to=${to}`;
  },
  parseCandles(json) {
    const j = json as { candles?: { time: number; open: string; high: string; low: string; close: string; volume: number | string }[]; error?: string };
    if (!Array.isArray(j.candles)) fail("Kraken Futures", j.error ?? "keine Kerzen");
    return j.candles!.map((c) => ({ time: Math.floor(num(c.time) / 1000), open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume) }));
  },
  wsUrl: "wss://futures.kraken.com/ws/v1",
  subscribe: (native) => JSON.stringify({ event: "subscribe", feed: "trade", product_ids: [native] }),
  parseTrades(msg) {
    const m = msg as { feed?: string; price?: number; qty?: number; time?: number };
    return m.feed === "trade" && m.price ? [{ price: num(m.price), size: num(m.qty ?? 0), timeMs: num(m.time) }] : [];
  },
};

const kraken: Venue = {
  id: "KRAKEN",
  name: "Kraken",
  defaultQuote: "USD",
  perpQuote: "USD",
  resolve(rest) {
    // Futures under their own names: PF_XBTUSD (perpetual), PI_XBTUSD (inverse), FF_XBTUSD_260327, FI_XBTUSD_260327.
    const fut = /^(PF|PI|FF|FI)_([A-Z0-9]+?)(USD|EUR|GBP|USDT|USDC)(_\d{6})?$/.exec(rest);
    if (fut) {
      const pair = { base: krakenCoin(fut[2]), quote: fut[3] };
      const kind: MarketKind = fut[1].startsWith("P") ? "perp" : "future";
      return { venue: kraken, kind, pair, native: rest, inverse: fut[1].endsWith("I"), feed: krakenFutures };
    }
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    if (perp) return { venue: kraken, kind: "perp", pair, native: `PF_${krakenAsset(pair.base)}${pair.quote}`, feed: krakenFutures };
    return { venue: kraken, kind: "spot", pair, native: `${krakenAsset(pair.base)}${krakenAsset(pair.quote)}`, wsNative: `${pair.base}/${pair.quote}`, feed: krakenSpot };
  },
};

// ---------------- Bybit ----------------

type BybitCategory = "spot" | "linear" | "inverse";

function bybitFeed(category: BybitCategory): Feed {
  return {
    intervals: { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720", "1d": "D", "1w": "W", "1M": "M" },
    maxLimit: 1000,
    paging: true,
    candlesUrl: (native, code, limit, endSec) =>
      `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${native}&interval=${code}&limit=${limit}${endSec ? `&end=${endSec * 1000 - 1}` : ""}`,
    parseCandles(json) {
      const j = json as { retCode?: number; retMsg?: string; result?: { list?: unknown[][] } };
      if (j.retCode !== 0) fail("Bybit", j.retMsg ?? "Fehler");
      // [start ms, open, high, low, close, volume, turnover], newest first.
      return (j.result?.list ?? []).map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) })).reverse();
    },
    wsUrl: `wss://stream.bybit.com/v5/public/${category}`,
    subscribe: (native) => JSON.stringify({ op: "subscribe", args: [`publicTrade.${native}`] }),
    // Bybit closes connections that send nothing for a while; it asks for a ping every 20 s.
    ping: { everyMs: 20_000, message: JSON.stringify({ op: "ping" }) },
    parseTrades(msg) {
      const m = msg as { topic?: string; data?: { T: number; p: string; v: string }[] };
      if (!m.topic?.startsWith("publicTrade.") || !Array.isArray(m.data)) return [];
      return m.data.map((t) => ({ price: num(t.p), size: num(t.v), timeMs: num(t.T) }));
    },
  };
}

const BYBIT = { spot: bybitFeed("spot"), linear: bybitFeed("linear"), inverse: bybitFeed("inverse") };
const BYBIT_EXPIRY = `\\d{1,2}(?:${MONTHS.join("|")})\\d{2}`;

const bybit: Venue = {
  id: "BYBIT",
  name: "Bybit",
  defaultQuote: "USDT",
  perpQuote: "USDT",
  resolve(rest) {
    // Dated: BTCUSDT-27MAR26 (USDT), BTC-27MAR26 (USDC), BTCUSDH26 (inverse, month code and year).
    const usdt = new RegExp(`^([A-Z0-9]+)USDT-${BYBIT_EXPIRY}$`).exec(rest);
    if (usdt) return { venue: bybit, kind: "future", pair: { base: usdt[1], quote: "USDT" }, native: rest, feed: BYBIT.linear };
    const usdc = new RegExp(`^([A-Z0-9]+)-${BYBIT_EXPIRY}$`).exec(rest);
    if (usdc) return { venue: bybit, kind: "future", pair: { base: usdc[1], quote: "USDC" }, native: rest, feed: BYBIT.linear };
    const inv = /^([A-Z0-9]+)USD[FGHJKMNQUVXZ]\d{2}$/.exec(rest);
    if (inv) return { venue: bybit, kind: "future", pair: { base: inv[1], quote: "USD" }, native: rest, inverse: true, feed: BYBIT.inverse };
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    if (!perp) return { venue: bybit, kind: "spot", pair, native: pair.base + pair.quote, feed: BYBIT.spot };
    // USDC perpetuals are called BTCPERP; inverse ones BTCUSD.
    if (pair.quote === "USD") return { venue: bybit, kind: "perp", pair, native: `${pair.base}USD`, inverse: true, feed: BYBIT.inverse };
    return { venue: bybit, kind: "perp", pair, native: pair.quote === "USDC" ? `${pair.base}PERP` : pair.base + pair.quote, feed: BYBIT.linear };
  },
};

// ---------------- OKX ----------------

const okxFeed: Feed = {
  // From 6 h on OKX counts in Hong Kong time unless the code ends in "utc".
  intervals: { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6Hutc", "12h": "12Hutc", "1d": "1Dutc", "1w": "1Wutc", "1M": "1Mutc" },
  maxLimit: 300,
  paging: true,
  candlesUrl: (native, code, limit, endSec) => `https://www.okx.com/api/v5/market/candles?instId=${native}&bar=${code}&limit=${limit}${endSec ? `&after=${endSec * 1000}` : ""}`,
  parseCandles(json) {
    const j = json as { code?: string; msg?: string; data?: unknown[][] };
    if (j.code !== "0") fail("OKX", j.msg || "Fehler");
    // [ts, open, high, low, close, volume, …], newest first.
    return (j.data ?? []).map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) })).reverse();
  },
  wsUrl: "wss://ws.okx.com:8443/ws/v5/public",
  subscribe: (native) => JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: native }] }),
  // OKX drops a connection after 30 s without traffic; "ping" is answered with "pong".
  ping: { everyMs: 25_000, message: "ping" },
  parseTrades(msg) {
    const m = msg as { arg?: { channel?: string }; data?: { px: string; sz: string; ts: string }[] };
    if (m.arg?.channel !== "trades" || !Array.isArray(m.data)) return [];
    return m.data.map((t) => ({ price: num(t.px), size: num(t.sz), timeMs: num(t.ts) }));
  },
};

const okx: Venue = {
  id: "OKX",
  name: "OKX",
  defaultQuote: "USDT",
  perpQuote: "USDT",
  resolve(rest) {
    // OKX's own names: BTC-USDT-SWAP, BTC-USD-260327.
    const own = /^([A-Z0-9]+)-([A-Z]+)-(SWAP|\d{6})$/.exec(rest);
    if (own) return { venue: okx, kind: own[3] === "SWAP" ? "perp" : "future", pair: { base: own[1], quote: own[2] }, native: rest, inverse: own[2] === "USD", feed: okxFeed };
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    if (perp) return { venue: okx, kind: "perp", pair, native: `${pair.base}-${pair.quote}-SWAP`, inverse: pair.quote === "USD", feed: okxFeed };
    return { venue: okx, kind: "spot", pair, native: `${pair.base}-${pair.quote}`, feed: okxFeed };
  },
};

// ---------------- Bitstamp ----------------

const bitstampFeed: Feed = {
  intervals: { "1m": "60", "3m": "180", "5m": "300", "15m": "900", "30m": "1800", "1h": "3600", "2h": "7200", "4h": "14400", "6h": "21600", "12h": "43200", "1d": "86400", "3d": "259200" },
  maxLimit: 1000,
  paging: true,
  candlesUrl: (native, code, limit, endSec) => `https://www.bitstamp.net/api/v2/ohlc/${native}/?step=${code}&limit=${limit}${endSec ? `&end=${endSec - 1}` : ""}`,
  parseCandles(json) {
    const j = json as { data?: { ohlc?: Record<string, string>[] }; errors?: { message?: string }[]; message?: string };
    if (!j.data?.ohlc) fail("Bitstamp", j.errors?.[0]?.message ?? j.message ?? "Paar nicht gefunden");
    return j.data!.ohlc!.map((r) => ({ time: num(r.timestamp), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume) }));
  },
  wsUrl: "wss://ws.bitstamp.net",
  subscribe: (native) => JSON.stringify({ event: "bts:subscribe", data: { channel: `live_trades_${native}` } }),
  parseTrades(msg) {
    const m = msg as { event?: string; data?: { price: number; amount: number; microtimestamp?: string; timestamp?: string } };
    if (m.event !== "trade" || !m.data) return [];
    const timeMs = m.data.microtimestamp ? Math.floor(num(m.data.microtimestamp) / 1000) : num(m.data.timestamp) * 1000;
    return [{ price: num(m.data.price), size: num(m.data.amount), timeMs }];
  },
};

const bitstamp: Venue = {
  id: "BITSTAMP",
  name: "Bitstamp",
  defaultQuote: "USD",
  resolve(rest) {
    const pair = splitPair(rest);
    return pair && /^[A-Z0-9]+$/.test(rest) ? { venue: bitstamp, kind: "spot", pair, native: (pair.base + pair.quote).toLowerCase(), feed: bitstampFeed } : null;
  },
};

// ---------------- Bitfinex ----------------

/** Bitfinex writes USDT as UST and puts a colon into longer names (tBTCUSD, tDOGE:USD). */
function bitfinexSymbol(p: VenuePair): string {
  const quote = p.quote === "USDT" ? "UST" : p.quote;
  return `t${p.base}${p.base.length > 3 || quote.length > 3 ? ":" : ""}${quote}`;
}

const bitfinexFeed: Feed = {
  intervals: { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "3h": "3h", "6h": "6h", "12h": "12h", "1d": "1D", "1w": "1W", "1M": "1M" },
  maxLimit: 1000,
  paging: true,
  candlesUrl: (native, code, limit, endSec) => `https://api-pub.bitfinex.com/v2/candles/trade:${code}:${native}/hist?limit=${limit}&sort=-1${endSec ? `&end=${endSec * 1000 - 1}` : ""}`,
  parseCandles(json) {
    if (!Array.isArray(json) || json[0] === "error") fail("Bitfinex", Array.isArray(json) ? String(json[2] ?? "Fehler") : "keine Kerzen");
    // [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME], newest first (sort=-1).
    return (json as number[][]).map((r) => ({ time: Math.floor(r[0] / 1000), open: r[1], close: r[2], high: r[3], low: r[4], volume: r[5] })).reverse();
  },
  wsUrl: "wss://api-pub.bitfinex.com/ws/2",
  subscribe: (native) => JSON.stringify({ event: "subscribe", channel: "trades", symbol: native }),
  parseTrades(msg) {
    // [chanId, "te", [ID, MTS, AMOUNT, PRICE]]; "tu" repeats the trade, snapshots and heartbeats are skipped.
    if (!Array.isArray(msg) || msg[1] !== "te" || !Array.isArray(msg[2])) return [];
    const [, mts, amount, price] = msg[2] as number[];
    return [{ price, size: Math.abs(amount), timeMs: mts }];
  },
};

const bitfinex: Venue = {
  id: "BITFINEX",
  name: "Bitfinex",
  defaultQuote: "USD",
  perpQuote: "USDT",
  resolve(rest) {
    // Perpetuals: BTCUSDT.P → tBTCF0:USTF0 (Bitfinex's only perpetual quote is USDt).
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    if (perp) return pair.quote === "USDT" ? { venue: bitfinex, kind: "perp", pair, native: `t${pair.base}F0:USTF0`, feed: bitfinexFeed } : null;
    return { venue: bitfinex, kind: "spot", pair, native: bitfinexSymbol(pair), feed: bitfinexFeed };
  },
};

// ---------------- Lookup ----------------

const ALL: Venue[] = [binance, coinbase, kraken, bybit, okx, bitstamp, bitfinex];

export const VENUES: { id: VenueId; name: string; perps: boolean }[] = ALL.map((v) => ({ id: v.id, name: v.name, perps: !!v.perpQuote }));

export function getVenue(id: string): Venue | undefined {
  return ALL.find((v) => v.id === id.toUpperCase());
}

export function venueName(id: string): string {
  return getVenue(id)?.name ?? id;
}

/** COINBASE:BTCUSD, BINANCE:BTCUSDT.P, OKX:BTC-USD-260327 … → the market; null for plain symbols and Binance spot. */
export function parseVenueSymbol(symbol: string): Instrument | null {
  const m = /^([A-Z]+):(.+)$/i.exec(symbol.trim());
  const venue = m && getVenue(m[1]);
  return venue ? venue.resolve(m![2].toUpperCase()) : null;
}

/** The symbol names one of these exchanges ("KRAKEN:…"), whether or not the market exists. */
export function isVenuePrefixed(symbol: string): boolean {
  const m = /^([A-Z]+):/i.exec(symbol.trim());
  return !!m && !!getVenue(m[1]);
}

/** BINANCE:BTCUSDT → BTCUSDT: Binance spot stays plain, as everywhere else in the app. Derivatives keep their prefix. */
export function stripBinance(symbol: string): string {
  return symbol.replace(/^BINANCE:(?=[A-Z0-9]+$)/i, "");
}

/** The plain pair behind a symbol (COINBASE:BTCUSD → BTCUSD, BINANCE:BTCUSDT.P → BTCUSDT). */
export function plainSymbol(symbol: string): string {
  const inst = parseVenueSymbol(symbol);
  return inst ? inst.pair.base + inst.pair.quote : symbol.replace(/^[A-Z]+:/i, "");
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

/** The usual perpetual of a coin on an exchange (BTCUSDT → BYBIT:BTCUSDT.P, KRAKEN:BTCUSD.P); null where it has none. */
export function perpSymbol(venueId: string, binanceSymbol: string): string | null {
  const venue = getVenue(venueId);
  const pair = splitPair(plainSymbol(binanceSymbol));
  if (!venue?.perpQuote || !pair) return null;
  return `${venue.id}:${pair.base}${venue.perpQuote}.P`;
}

export const KIND_LABEL: Record<MarketKind, string> = { spot: "Spot", perp: "Perpetual", future: "Futures" };
