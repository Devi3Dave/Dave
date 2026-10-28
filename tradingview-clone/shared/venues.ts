/**
 * Crypto markets of several exchanges, written like TradingView's symbols:
 * - Spot: COINBASE:BTCUSD, KRAKEN:ETHEUR, BYBIT:SOLUSDT …
 * - Perpetuals with ".P": BINANCE:BTCUSDT.P (USDⓈ-M), BINANCE:BTCUSD.P (COIN-M), BYBIT:BTCUSDT.P, OKX:BTCUSDT.P,
 *   KRAKEN:BTCUSD.P, BITFINEX:BTCUSDT.P
 * - Futures with an expiry under the exchange's own name: BINANCE:BTCUSDT_260327, OKX:BTC-USD-260327,
 *   BYBIT:BTCUSDT-27MAR26, BYBIT:BTCUSDH26, KRAKEN:FF_XBTUSD_260327, DERIBIT:BTC-27MAR26, BITMEX:XBTZ26
 * - Options under the exchange's own name: DERIBIT:BTC-27MAR26-100000-C, OKX:BTC-USD-260327-100000-C,
 *   BINANCE:BTC-260327-100000-C (Bybit has no public option candles)
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
 * - Bitget: bitget.com/api-doc (v2 GET /spot/market/candles and /mix/market/candles; WebSocket v2 channel "trade")
 * - KuCoin: kucoin.com/docs (GET /api/v1/market/candles, futures /api/v1/kline/query; its WebSocket needs a
 *   token from a POST first, so KuCoin charts reload every minute instead of streaming)
 * - Deribit: docs.deribit.com (public/get_tradingview_chart_data for futures and options; channel trades.{instrument}.100ms)
 * - BitMEX: bitmex.com/app/apiOverview (GET /api/v1/trade/bucketed, stamped at the bucket's end; realtime table "trade")
 * - Binance options: developers.binance.com European options (GET /eapi/v1/klines; stream <symbol>@trade)
 */
import type { Bar } from "./math.js";

export type VenueId = "BINANCE" | "COINBASE" | "KRAKEN" | "BYBIT" | "OKX" | "BITSTAMP" | "BITFINEX" | "BITGET" | "KUCOIN" | "DERIBIT" | "BITMEX";
export type MarketKind = "spot" | "perp" | "future" | "option";

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
  /**
   * The browser blocks its REST calls (no CORS headers) and there is no WebSocket way around it,
   * as Devi's connection test in Safari showed on 2026-10-28. Loading is still tried, the picker warns.
   */
  blocked?: boolean;
  /** None: the chart reloads over REST instead of streaming (KuCoin). */
  wsUrl?: string;
  subscribe(native: string): string;
  /** Message to keep the connection open, and how often. */
  ping?: { everyMs: number; message: string };
  parseTrades(msg: unknown): VenueTrade[];
  /**
   * Candles over the WebSocket, for when the browser blocks the REST call (CORS, Safari's
   * "Load failed"). WebSockets are not subject to CORS. `paging`: older pages can be asked for too.
   */
  wsHistory?: {
    paging: boolean;
    /** Request for `limit` candles of our time frame `interval`, ending before `endSec`. */
    request(native: string, interval: string, limit: number, endSec?: number): string;
    /** The candles in a reply, oldest first; null for other messages (acks, heartbeats). Throws the exchange's error. */
    parse(msg: unknown): Bar[] | null;
  };
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
  /** No spot charts: why (Deribit routes spot to Coinbase and serves no candles for it). The picker then loads perpetuals. */
  noSpot?: string;
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

// USDⓈ-M streams are routed: trades and klines only arrive on /market, a plain /ws stays silent
// (https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams).
const binanceUsdm = binanceFeed("https://fapi.binance.com/fapi/v1/klines", "wss://fstream.binance.com/market/ws");
// eapi.binance.com sends no CORS headers: blocked in the browser (Devi's connection test, 2026-10-28).
const binanceOptions: Feed = {
  blocked: true,
  ...binanceFeed("https://eapi.binance.com/eapi/v1/klines", "wss://nbstream.binance.com/eoptions/ws"),
  intervals: Object.fromEntries(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w"].map((i) => [i, i])),
  maxLimit: 1500,
  // Option klines are objects: { openTime, open, high, low, close, volume }.
  parseCandles(json) {
    if (!Array.isArray(json)) return fail("Binance Optionen", (json as { msg?: string })?.msg ?? "keine Kerzen");
    if (Array.isArray(json[0])) return klineRows("Binance Optionen", json);
    return (json as Record<string, string | number>[]).map((r) => ({ time: Math.floor(num(r.openTime) / 1000), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume) }));
  },
  subscribe: (native) => JSON.stringify({ method: "SUBSCRIBE", params: [`${native}@trade`], id: 1 }),
  parseTrades(msg) {
    const m = msg as { e?: string; p?: string; q?: string; T?: number };
    return m.e === "trade" ? [{ price: num(m.p), size: num(m.q), timeMs: num(m.T) }] : [];
  },
};
const binanceCoinm = binanceFeed("https://dapi.binance.com/dapi/v1/klines", "wss://dstream.binance.com/ws");

const binance: Venue = {
  id: "BINANCE",
  name: "Binance",
  defaultQuote: "USDT",
  perpQuote: "USDT",
  resolve(rest) {
    // Options: BTC-260327-100000-C (settled in USDT).
    const opt = /^([A-Z0-9]+)-\d{6}-\d+(?:\.\d+)?-[CP]$/.exec(rest);
    if (opt) return { venue: binance, kind: "option", pair: { base: opt[1], quote: "USDT" }, native: rest, feed: binanceOptions };
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

const krakenSpotIntervals: Record<string, string> = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "1440", "1w": "10080" };

const krakenSpot: Feed = {
  intervals: krakenSpotIntervals,
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
  // WS v2 "ohlc" channel, snapshot of the newest candles (https://docs.kraken.com/api/docs/websocket-v2/ohlc).
  wsHistory: {
    paging: false,
    request: (native, interval) =>
      JSON.stringify({ method: "subscribe", params: { channel: "ohlc", symbol: [native], interval: Number(krakenSpotIntervals[interval]), snapshot: true } }),
    parse(msg) {
      const m = msg as { method?: string; success?: boolean; error?: string; channel?: string; type?: string; data?: { open: number; high: number; low: number; close: number; volume: number; interval_begin: string }[] };
      if (m.method === "subscribe" && m.success === false) fail("Kraken", m.error ?? "Abo abgelehnt");
      if (m.channel !== "ohlc" || m.type !== "snapshot" || !Array.isArray(m.data)) return null;
      return m.data
        .map((c) => ({ time: Math.floor(Date.parse(c.interval_begin) / 1000), open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume) }))
        .sort((a, b) => a.time - b.time);
    },
  },
};

const KRAKEN_FUTURES_STEP: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "12h": 43200, "1d": 86400, "1w": 604800 };

const krakenFutures: Feed = {
  blocked: true,
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
    // OKX's own names: BTC-USDT-SWAP, BTC-USD-260327, options BTC-USD-260327-100000-C.
    const opt = /^([A-Z0-9]+)-(USD|USDT|USDC)-\d{6}-\d+(?:\.\d+)?-[CP]$/.exec(rest);
    if (opt) return { venue: okx, kind: "option", pair: { base: opt[1], quote: opt[2] }, native: rest, inverse: opt[2] === "USD", feed: okxFeed };
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

const bitfinexIntervals: Record<string, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "3h": "3h", "6h": "6h", "12h": "12h", "1d": "1D", "1w": "1W", "1M": "1M" };

const bitfinexFeed: Feed = {
  intervals: bitfinexIntervals,
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
  // "candles" channel: the first message is a snapshot of the newest candles (https://docs.bitfinex.com/reference/ws-public-candles).
  wsHistory: {
    paging: false,
    request: (native, interval) => JSON.stringify({ event: "subscribe", channel: "candles", key: `trade:${bitfinexIntervals[interval]}:${native}` }),
    parse(msg) {
      if (!Array.isArray(msg)) {
        const m = msg as { event?: string; msg?: string };
        if (m.event === "error") fail("Bitfinex", m.msg ?? "Abo abgelehnt");
        return null;
      }
      // [chanId, [[MTS, OPEN, CLOSE, HIGH, LOW, VOLUME], …]], newest first; updates carry a single candle.
      const rows = msg[1];
      if (!Array.isArray(rows) || !Array.isArray(rows[0])) return null;
      return (rows as number[][]).map((r) => ({ time: Math.floor(r[0] / 1000), open: r[1], close: r[2], high: r[3], low: r[4], volume: r[5] })).sort((a, b) => a.time - b.time);
    },
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

// ---------------- Bitget ----------------

type BitgetProduct = "SPOT" | "USDT-FUTURES" | "USDC-FUTURES" | "COIN-FUTURES";

/** WebSocket candle channel suffix, the same for spot and futures. */
const BITGET_WS_CANDLE: Record<string, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "6h": "6H", "12h": "12H", "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M",
};

function bitgetFeed(product: BitgetProduct): Feed {
  const spot = product === "SPOT";
  return {
    intervals: spot
      ? { "1m": "1min", "3m": "3min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "6h": "6h", "12h": "12h", "1d": "1day", "3d": "3day", "1w": "1week", "1M": "1M" }
      : { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "6h": "6H", "12h": "12H", "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M" },
    maxLimit: spot ? 1000 : 1000,
    paging: true,
    candlesUrl: (native, code, limit, endSec) =>
      spot
        ? `https://api.bitget.com/api/v2/spot/market/candles?symbol=${native}&granularity=${code}&limit=${limit}${endSec ? `&endTime=${endSec * 1000 - 1}` : ""}`
        : `https://api.bitget.com/api/v2/mix/market/candles?symbol=${native}&productType=${product}&granularity=${code}&limit=${limit}${endSec ? `&endTime=${endSec * 1000 - 1}` : ""}`,
    parseCandles(json) {
      const j = json as { code?: string; msg?: string; data?: unknown[][] };
      if (j.code !== "00000") fail("Bitget", j.msg ?? "Fehler");
      // [ts ms, open, high, low, close, base volume, …]
      return (j.data ?? []).map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) })).sort((a, b) => a.time - b.time);
    },
    wsUrl: "wss://ws.bitget.com/v2/ws/public",
    subscribe: (native) => JSON.stringify({ op: "subscribe", args: [{ instType: product, channel: "trade", instId: native }] }),
    // Bitget closes connections without a "ping" for 2 minutes.
    ping: { everyMs: 30_000, message: "ping" },
    parseTrades(msg) {
      const m = msg as { arg?: { channel?: string }; action?: string; data?: { ts: string; price: string; size: string }[] };
      if (m.arg?.channel !== "trade" || m.action !== "update" || !Array.isArray(m.data)) return [];
      return m.data.map((t) => ({ price: num(t.price), size: num(t.size), timeMs: num(t.ts) }));
    },
    // Public "candle" channel, first push is a snapshot (https://www.bitget.com/api-doc/spot/websocket/public/Candlesticks-Channel).
    wsHistory: {
      paging: false,
      request: (native, interval) => JSON.stringify({ op: "subscribe", args: [{ instType: product, channel: `candle${BITGET_WS_CANDLE[interval]}`, instId: native }] }),
      parse(msg) {
        const m = msg as { event?: string; msg?: string; arg?: { channel?: string }; action?: string; data?: unknown[][] };
        if (m.event === "error") fail("Bitget", m.msg ?? "Abo abgelehnt");
        if (!m.arg?.channel?.startsWith("candle") || m.action !== "snapshot" || !Array.isArray(m.data)) return null;
        return m.data.map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) })).sort((a, b) => a.time - b.time);
      },
    },
  };
}

const BITGET = { spot: bitgetFeed("SPOT"), usdt: bitgetFeed("USDT-FUTURES"), usdc: bitgetFeed("USDC-FUTURES"), coin: bitgetFeed("COIN-FUTURES") };

const bitget: Venue = {
  id: "BITGET",
  name: "Bitget",
  defaultQuote: "USDT",
  perpQuote: "USDT",
  resolve(rest) {
    // Coin-margined delivery contracts: BTCUSDZ25 (month code and year).
    const dated = /^([A-Z0-9]+)USD([FGHJKMNQUVXZ]\d{2})$/.exec(rest);
    if (dated) return { venue: bitget, kind: "future", pair: { base: dated[1], quote: "USD" }, native: rest, inverse: true, feed: BITGET.coin };
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    if (!perp) return { venue: bitget, kind: "spot", pair, native: pair.base + pair.quote, feed: BITGET.spot };
    if (pair.quote === "USD") return { venue: bitget, kind: "perp", pair, native: `${pair.base}USD`, inverse: true, feed: BITGET.coin };
    if (pair.quote === "USDC") return { venue: bitget, kind: "perp", pair, native: `${pair.base}PERP`, feed: BITGET.usdc };
    return { venue: bitget, kind: "perp", pair, native: pair.base + pair.quote, feed: BITGET.usdt };
  },
};

// ---------------- KuCoin ----------------

const KUCOIN_SPOT_TYPE: Record<string, [string, number]> = {
  "1m": ["1min", 60], "3m": ["3min", 180], "5m": ["5min", 300], "15m": ["15min", 900], "30m": ["30min", 1800], "1h": ["1hour", 3600], "2h": ["2hour", 7200],
  "4h": ["4hour", 14400], "6h": ["6hour", 21600], "8h": ["8hour", 28800], "12h": ["12hour", 43200], "1d": ["1day", 86400], "1w": ["1week", 604800],
};
const KUCOIN_SPOT_STEP = Object.fromEntries(Object.values(KUCOIN_SPOT_TYPE));

const kucoinSpot: Feed = {
  blocked: true,
  intervals: Object.fromEntries(Object.entries(KUCOIN_SPOT_TYPE).map(([k, [code]]) => [k, code])),
  maxLimit: 1500,
  paging: true,
  candlesUrl(native, code, limit, endSec) {
    const end = endSec ? endSec - 1 : Math.floor(Date.now() / 1000);
    return `https://api.kucoin.com/api/v1/market/candles?type=${code}&symbol=${native}&startAt=${end - limit * KUCOIN_SPOT_STEP[code]}&endAt=${end}`;
  },
  parseCandles(json) {
    const j = json as { code?: string; msg?: string; data?: string[][] };
    if (j.code !== "200000") fail("KuCoin", j.msg ?? "Fehler");
    // [time s, open, close, high, low, volume, turnover], newest first.
    return (j.data ?? []).map((r) => ({ time: num(r[0]), open: num(r[1]), close: num(r[2]), high: num(r[3]), low: num(r[4]), volume: num(r[5]) })).reverse();
  },
  subscribe: () => "",
  parseTrades: () => [],
};

const KUCOIN_FUTURES_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "8h": 480, "12h": 720, "1d": 1440, "1w": 10080 };

const kucoinFutures: Feed = {
  blocked: true,
  intervals: Object.fromEntries(Object.entries(KUCOIN_FUTURES_MIN).map(([k, m]) => [k, String(m)])),
  maxLimit: 500,
  paging: true,
  candlesUrl(native, code, limit, endSec) {
    const end = endSec ? endSec * 1000 - 1 : Date.now();
    return `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${native}&granularity=${code}&from=${end - limit * Number(code) * 60_000}&to=${end}`;
  },
  parseCandles(json) {
    const j = json as { code?: string; msg?: string; data?: number[][] };
    if (j.code !== "200000") fail("KuCoin Futures", j.msg ?? "Fehler");
    // [time ms, open, high, low, close, volume], oldest first.
    return (j.data ?? []).map((r) => ({ time: Math.floor(num(r[0]) / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) }));
  },
  subscribe: () => "",
  parseTrades: () => [],
};

/** KuCoin futures call Bitcoin XBT: BTCUSDT.P → XBTUSDTM, BTCUSD.P → XBTUSDM (inverse). */
const kucoinFutAsset = (a: string) => (a === "BTC" ? "XBT" : a);

const kucoin: Venue = {
  id: "KUCOIN",
  name: "KuCoin",
  defaultQuote: "USDT",
  perpQuote: "USDT",
  resolve(rest) {
    // Dated coin-margined futures: XBTMZ25.
    const dated = /^([A-Z0-9]+)M([FGHJKMNQUVXZ]\d{2})$/.exec(rest);
    if (dated) return { venue: kucoin, kind: "future", pair: { base: krakenCoin(dated[1]), quote: "USD" }, native: rest, inverse: true, feed: kucoinFutures };
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    if (!perp) return { venue: kucoin, kind: "spot", pair, native: `${pair.base}-${pair.quote}`, feed: kucoinSpot };
    return { venue: kucoin, kind: "perp", pair, native: `${kucoinFutAsset(pair.base)}${pair.quote}M`, inverse: pair.quote === "USD", feed: kucoinFutures };
  },
};

// ---------------- Deribit ----------------

const DERIBIT_RES: Record<string, [string, number]> = {
  "1m": ["1", 60], "3m": ["3", 180], "5m": ["5", 300], "15m": ["15", 900], "30m": ["30", 1800], "1h": ["60", 3600], "2h": ["120", 7200],
  "3h": ["180", 10800], "6h": ["360", 21600], "12h": ["720", 43200], "1d": ["1D", 86400],
};
const DERIBIT_STEP = Object.fromEntries(Object.values(DERIBIT_RES));

/** Query of get_tradingview_chart_data, for REST and JSON-RPC over the WebSocket. */
function deribitChartParams(native: string, code: string, limit: number, endSec?: number) {
  const end = endSec ? endSec * 1000 - 1 : Date.now();
  return { instrument_name: native, resolution: code, start_timestamp: end - limit * DERIBIT_STEP[code] * 1000, end_timestamp: end };
}

const DERIBIT_HISTORY_ID = 7;

const deribitFeed: Feed = {
  intervals: Object.fromEntries(Object.entries(DERIBIT_RES).map(([k, [code]]) => [k, code])),
  maxLimit: 1000,
  paging: true,
  candlesUrl(native, code, limit, endSec) {
    const q = deribitChartParams(native, code, limit, endSec);
    return `https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=${q.instrument_name}&resolution=${q.resolution}&start_timestamp=${q.start_timestamp}&end_timestamp=${q.end_timestamp}`;
  },
  parseCandles(json) {
    const j = json as { result?: { status?: string; ticks?: number[]; open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }; error?: { message?: string } };
    const r = j.result;
    if (!r?.ticks) return fail("Deribit", j.error?.message ?? "keine Kerzen");
    return r.ticks.map((t, i) => ({ time: Math.floor(t / 1000), open: r.open![i], high: r.high![i], low: r.low![i], close: r.close![i], volume: r.volume![i] }));
  },
  wsUrl: "wss://www.deribit.com/ws/api/v2",
  subscribe: (native) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "public/subscribe", params: { channels: [`trades.${native}.100ms`] } }),
  ping: { everyMs: 30_000, message: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "public/test", params: {} }) },
  parseTrades(msg) {
    const m = msg as { method?: string; params?: { channel?: string; data?: { price: number; amount: number; timestamp: number }[] } };
    if (m.method !== "subscription" || !m.params?.channel?.startsWith("trades.") || !Array.isArray(m.params.data)) return [];
    return m.params.data.map((t) => ({ price: num(t.price), size: num(t.amount), timeMs: num(t.timestamp) }));
  },
  // The same method as JSON-RPC over the WebSocket (https://docs.deribit.com/#public-get_tradingview_chart_data).
  wsHistory: {
    paging: true,
    request: (native, interval, limit, endSec) =>
      JSON.stringify({ jsonrpc: "2.0", id: DERIBIT_HISTORY_ID, method: "public/get_tradingview_chart_data", params: deribitChartParams(native, DERIBIT_RES[interval][0], limit, endSec) }),
    parse(msg) {
      const m = msg as { id?: number };
      return m.id === DERIBIT_HISTORY_ID ? deribitFeed.parseCandles(msg) : null;
    },
  },
};

const DERIBIT_DAY = `\\d{1,2}(?:${MONTHS.join("|")})\\d{2}`;

const deribit: Venue = {
  id: "DERIBIT",
  name: "Deribit",
  defaultQuote: "USDC",
  perpQuote: "USD",
  noSpot: "Deribit leitet Spot an Coinbase weiter und liefert dafür keine Kerzen",
  resolve(rest) {
    // Deribit's own names: BTC-PERPETUAL (inverse), BTC_USDC-PERPETUAL, BTC-27MAR26, BTC-27MAR26-100000-C. No spot (see noSpot).
    // Decimal strikes are written with a "d" (0d625); symbols arrive upper-cased.
    const own = new RegExp(`^([A-Z0-9]+)(?:_(USDC|USDT))?-(PERPETUAL|${DERIBIT_DAY})(-\\d+(?:D\\d+)?-[CP])?$`).exec(rest.toUpperCase());
    if (own) {
      const quote = own[2] ?? "USD";
      const kind: MarketKind = own[4] ? "option" : own[3] === "PERPETUAL" ? "perp" : "future";
      const native = rest.toUpperCase().replace(/(\d)D(\d)/, "$1d$2");
      return { venue: deribit, kind, pair: { base: own[1], quote }, native, inverse: quote === "USD", feed: deribitFeed };
    }
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    if (perp) {
      if (pair.quote === "USD") return { venue: deribit, kind: "perp", pair, native: `${pair.base}-PERPETUAL`, inverse: true, feed: deribitFeed };
      return pair.quote === "USDC" || pair.quote === "USDT" ? { venue: deribit, kind: "perp", pair, native: `${pair.base}_${pair.quote}-PERPETUAL`, feed: deribitFeed } : null;
    }
    return null;
  },
};

// ---------------- BitMEX ----------------

const BITMEX_BIN: Record<string, number> = { "1m": 60, "5m": 300, "1h": 3600, "1d": 86400 };

// BitMEX's WebSocket failed in the same test too.
const bitmexFeed: Feed = {
  blocked: true,
  intervals: Object.fromEntries(Object.keys(BITMEX_BIN).map((k) => [k, k])),
  maxLimit: 1000,
  paging: true,
  candlesUrl: (native, code, limit, endSec) =>
    `https://www.bitmex.com/api/v1/trade/bucketed?binSize=${code}&partial=true&symbol=${native}&count=${limit}&reverse=true${endSec ? `&endTime=${new Date((endSec + BITMEX_BIN[code] - 1) * 1000).toISOString()}` : ""}`,
  parseCandles(json) {
    if (!Array.isArray(json)) return fail("BitMEX", (json as { error?: { message?: string } })?.error?.message ?? "keine Kerzen");
    const rows = json as { timestamp: string; open: number; high: number; low: number; close: number; volume: number }[];
    if (rows.length < 2) return rows.map((r) => ({ time: Date.parse(r.timestamp) / 1000, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
    // BitMEX stamps a bucket with its end: one bucket length earlier is its start. Newest first.
    const step = Math.abs(Date.parse(rows[0].timestamp) - Date.parse(rows[1].timestamp)) / 1000;
    return rows
      .filter((r) => r.open !== null && r.close !== null)
      .map((r) => ({ time: Date.parse(r.timestamp) / 1000 - step, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }))
      .reverse();
  },
  wsUrl: "wss://ws.bitmex.com/realtime",
  subscribe: (native) => JSON.stringify({ op: "subscribe", args: [`trade:${native}`] }),
  ping: { everyMs: 30_000, message: "ping" },
  parseTrades(msg) {
    const m = msg as { table?: string; action?: string; data?: { price: number; size: number; timestamp: string }[] };
    if (m.table !== "trade" || m.action !== "insert" || !Array.isArray(m.data)) return [];
    return m.data.map((t) => ({ price: num(t.price), size: num(t.size), timeMs: Date.parse(t.timestamp) }));
  },
};

const bitmex: Venue = {
  id: "BITMEX",
  name: "BitMEX",
  defaultQuote: "USDT",
  perpQuote: "USD",
  resolve(rest) {
    const xbt = (a: string) => (a === "BTC" ? "XBT" : a);
    // Dated futures: XBTZ26, ETHUSDZ26, XBTUSDTZ26.
    const dated = /^([A-Z0-9]+?)(USDT|USD)?([FGHJKMNQUVXZ]\d{2})$/.exec(rest);
    if (dated && !splitPair(rest)) return { venue: bitmex, kind: "future", pair: { base: krakenCoin(dated[1]), quote: dated[2] ?? "USD" }, native: rest, inverse: !dated[2], feed: bitmexFeed };
    const spot = /^([A-Z0-9]+)_(USDT|USDC|EUR)$/.exec(rest);
    if (spot) return { venue: bitmex, kind: "spot", pair: { base: krakenCoin(spot[1]), quote: spot[2] }, native: rest, feed: bitmexFeed };
    const perp = PERP.exec(rest);
    const pair = splitPair(perp?.[1] ?? rest);
    if (!pair || (!perp && !/^[A-Z0-9]+$/.test(rest))) return null;
    // BTCUSD.P → XBTUSD (inverse), BTCUSDT.P → XBTUSDT; spot BTCUSDT → XBT_USDT.
    if (perp) return { venue: bitmex, kind: "perp", pair, native: xbt(pair.base) + pair.quote, inverse: pair.quote === "USD", feed: bitmexFeed };
    return pair.quote === "USD" ? null : { venue: bitmex, kind: "spot", pair, native: `${xbt(pair.base)}_${pair.quote}`, feed: bitmexFeed };
  },
};

// ---------------- Lookup ----------------

const ALL: Venue[] = [binance, coinbase, kraken, bybit, okx, bitstamp, bitfinex, bitget, kucoin, deribit, bitmex];

const blockedFeed = (v: Venue, rest: string | null) => (rest ? !!v.resolve(rest)?.feed.blocked : false);

/**
 * The exchanges for the picker. `spotBlocked` / `perpBlocked`: the browser blocks BTC's spot or perpetual feed there
 * (Binance spot loads over the app's own path); `noSpot`: why there are no spot charts.
 */
export const VENUES: { id: VenueId; name: string; perps: boolean; noSpot?: string; spotBlocked: boolean; perpBlocked: boolean }[] = ALL.map((v) => ({
  id: v.id,
  name: v.name,
  perps: !!v.perpQuote,
  noSpot: v.noSpot,
  spotBlocked: blockedFeed(v, v.noSpot ? null : `BTC${v.defaultQuote}`),
  perpBlocked: blockedFeed(v, v.perpQuote ? `BTC${v.perpQuote}.P` : null),
}));

/**
 * The exchanges the picker offers: those whose charts load in the browser. KuCoin and BitMEX are left out
 * (Devi: what cannot load only clutters the choice); their code stays for symbols typed by hand.
 */
export const PICKER_VENUES = VENUES.filter((v) => !(v.noSpot || v.spotBlocked) || (v.perps && !v.perpBlocked));

/** Perpetuals the picker offers at this exchange: it has them and the browser can load them (not Kraken's). */
export const pickerPerps = (id: string) => !!PICKER_VENUES.find((v) => v.id === id && v.perps && !v.perpBlocked);

/** A market the browser cannot load (blocked feed); search leaves these out. */
export function isBlockedSymbol(symbol: string): boolean {
  return !!parseVenueSymbol(symbol)?.feed.blocked;
}

const KIND_SHORT: Record<MarketKind, string> = { spot: "Spot", perp: "Perp", future: "Future", option: "Option" };

/** Exchange, form and pair of an exchange symbol for headers: KRAKEN:BTCUSD → "Kraken · Spot · BTC/USD". */
export function marketTag(symbol: string): string | null {
  const inst = parseVenueSymbol(symbol);
  return inst ? `${inst.venue.name} · ${KIND_SHORT[inst.kind]} · ${inst.pair.base}/${inst.pair.quote}` : null;
}

/** The same for what the chart loaded: plain Binance spot and USDⓈ-M perpetuals included. */
export function loadedMarketTag(symbol: string, source: string | null | undefined): string | null {
  if (source === "venue") return marketTag(symbol);
  const pair = splitPair(plainSymbol(symbol));
  const pairText = pair ? `${pair.base}/${pair.quote}` : plainSymbol(symbol);
  if (source === "binance") return `Binance · Spot · ${pairText}`;
  if (source === "binance_futures") return `Binance · Perp · ${pairText}`;
  return null;
}

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

export const KIND_LABEL: Record<MarketKind, string> = { spot: "Spot", perp: "Perpetual", future: "Futures", option: "Option" };
