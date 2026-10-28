import type { Bar } from "./math.js";
import { addTrades, demoTrades, isTradeInterval, parseTradeInterval, tickSizeFromPrices, type Trade, type TradeInterval } from "./tickBars.js";
import { isVenuePrefixed, KIND_LABEL, parseVenueSymbol, stripBinance, type Feed, type Instrument } from "./venues.js";

export interface MarketData {
  symbol: string;
  interval: string;
  /** twelvedata: exchange prices with the user's own key (src/market/exchangeFeed.ts). */
  /** spread: computed from two symbols (shared/spread.ts), reloaded like Yahoo. */
  /** venue: a crypto market named by its exchange (COINBASE:BTCUSD, BINANCE:BTCUSDT.P, shared/venues.ts). */
  source: "binance" | "binance_futures" | "yahoo" | "twelvedata" | "spread" | "venue" | "demo";
  bars: Bar[];
  /** Tick and range charts (shared/tickBars.ts): the minimum price change and the last aggregate trade id, so the live stream continues them. */
  tickSize?: number;
  lastTradeId?: number;
}

export const INTERVAL_SECONDS: Record<string, number> = {
  "1s": 1,
  "5s": 5,
  "15s": 15,
  "30s": 30,
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "45m": 2700,
  "1h": 3600,
  "2h": 7200,
  "3h": 10800,
  "4h": 14400,
  "6h": 21600,
  "8h": 28800,
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "1w": 604800,
  // Calendar candles: the seconds are only an average length (demo data, axis format).
  "1M": 2629800,
  "3M": 7889400,
  "1y": 31557600,
  // Whole history: weekly candles, zoomed out to show everything.
  all: 604800,
};

/** Months per candle for calendar intervals (month, quarter, year). */
const CALENDAR_MONTHS: Record<string, number> = { "1M": 1, "3M": 3, "1y": 12 };

export function isCalendarInterval(interval: string): boolean {
  return interval in CALENDAR_MONTHS;
}

/** Custom time frames like TradingView's: a number with s, m, h or D (e.g. 7m, 90s, 3h, 2d), up to a week. */
const CUSTOM_INTERVAL = /^([1-9]\d{0,3})(s|m|h|d)$/;
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Length of a fixed time frame in seconds, or null for an unknown one. */
export function parseInterval(interval: string): number | null {
  if (interval in INTERVAL_SECONDS) return INTERVAL_SECONDS[interval];
  const m = CUSTOM_INTERVAL.exec(interval);
  if (!m) return null;
  const seconds = Number(m[1]) * UNIT_SECONDS[m[2]];
  return seconds <= 7 * 86400 ? seconds : null;
}

/** Time frames and tick or range intervals (100T, 10R). */
export const isValidInterval = (interval: string) => parseInterval(interval) !== null || isTradeInterval(interval);

/** Seconds per candle (average length for calendar candles); 1 for tick and range bars (axis with seconds); 1 h for unknown time frames. */
export const intervalSeconds = (interval: string): number => parseInterval(interval) ?? (isTradeInterval(interval) ? 1 : 3600);

/** The smallest unit that writes a time frame without fractions: 120m → 2h, 90s stays 90s. */
export function normalizeInterval(raw: string): string | null {
  const m = /^\s*(\d+)\s*(s|sek|sec|m|min|h|std|d|t|tag|tage)?\s*$/i.exec(raw);
  if (!m) return null;
  const unit = (m[2] ?? "m").toLowerCase();
  const u = unit === "h" || unit === "std" ? "h" : unit.startsWith("s") ? "s" : unit.startsWith("m") ? "m" : "d";
  let seconds = Number(m[1]) * UNIT_SECONDS[u];
  if (!(seconds > 0)) return null;
  for (const [suffix, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
    if (seconds % size === 0) {
      const iv = `${seconds / size}${suffix}`;
      return isValidInterval(iv) ? iv : null;
    }
  }
  return null;
}

/** Intervals Binance serves as klines (spot; futures have no 1s). */
const BINANCE_NATIVE = ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"];

/** The largest of `bases` whose length divides the time frame: candles to merge into it. */
export function baseInterval(interval: string, bases: string[]): string | null {
  const seconds = parseInterval(interval);
  if (seconds === null) return null;
  let best: string | null = null;
  for (const b of bases) {
    const s = INTERVAL_SECONDS[b];
    if (s && s <= Math.min(seconds, 86400) && seconds % s === 0 && (!best || s > INTERVAL_SECONDS[best])) best = b;
  }
  return best;
}

/** Binance candles to request: quarters and years from monthly candles, other time frames from the largest fitting kline. */
export function binanceInterval(interval: string): string {
  if (interval === "all") return "1w";
  if (isCalendarInterval(interval)) return "1M";
  if (BINANCE_NATIVE.includes(interval)) return interval;
  return baseInterval(interval, BINANCE_NATIVE) ?? interval;
}

/** Start of the candle a timestamp belongs to (UTC calendar for month/quarter/year). */
export function bucketTime(interval: string, time: number): number {
  const months = CALENDAR_MONTHS[interval];
  if (!months) {
    const step = intervalSeconds(interval);
    // Time frames that do not divide a day restart at 00:00 UTC each day, like TradingView restarts at the session start.
    if (step < 86400 && 86400 % step !== 0) {
      const day = Math.floor(time / 86400) * 86400;
      return day + Math.floor((time - day) / step) * step;
    }
    return Math.floor(time / step) * step;
  }
  // Half a day of slack: Yahoo stamps monthly candles of European markets at 23:00 UTC of the day before.
  const d = new Date((time + 43200) * 1000);
  const m = d.getUTCMonth();
  return Date.UTC(d.getUTCFullYear(), m - (m % months), 1) / 1000;
}

const CRYPTO_QUOTES = /^[A-Z0-9]{2,}(USDT|USDC|FDUSD|BUSD|BTC|ETH|BNB|EUR|TRY)$/;

export function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_QUOTES.test(symbol);
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    // Browsers set their own User-Agent; only the Node server needs one for Yahoo.
    headers: typeof window === "undefined" ? { "User-Agent": "Mozilla/5.0 (tradingview-claude)" } : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/**
 * The request never got an answer: blocked by the browser (CORS: Safari says "Load failed",
 * Chrome "Failed to fetch", Firefox "NetworkError …"), offline, or timed out.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const name = (e as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  return /load failed|failed to fetch|networkerror/i.test(String((e as Error | null)?.message ?? e));
}

/** German message for an exchange whose REST data the browser cannot reach. */
export function blockedMessage(venueName: string): string {
  return `${venueName} lässt den Abruf aus dem Browser nicht zu (CORS) oder ist gerade nicht erreichbar`;
}

/** One request over a WebSocket: send, wait for the first message `parse` accepts, close. */
export function wsRequest<T>(url: string, message: string, parse: (msg: unknown) => T | null, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === "undefined") return reject(new Error("WebSocket nicht verfügbar"));
    const ws = new WebSocket(url);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error("WebSocket: keine Antwort"))), timeoutMs);
    ws.onopen = () => ws.send(message);
    ws.onmessage = (ev) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return; // "pong" and other plain text
      }
      try {
        const out = parse(msg);
        if (out !== null) done(() => resolve(out));
      } catch (e) {
        done(() => reject(e));
      }
    };
    ws.onerror = () => done(() => reject(new Error("WebSocket-Verbindung fehlgeschlagen")));
    ws.onclose = () => done(() => reject(new Error("WebSocket geschlossen")));
  });
}

// data-api.binance.vision is Binance's public market-data mirror; it also
// works from regions where api.binance.com answers 451.
const SPOT_KLINES = ["https://api.binance.com/api/v3/klines", "https://data-api.binance.vision/api/v3/klines"];
// USDⓈ-M futures: besides crypto also TradFi perpetuals (gold, silver, oil, stocks) that trade 24/7.
const FUTURES_KLINES = ["https://fapi.binance.com/fapi/v1/klines"];

function fromBinance(symbol: string, interval: string, limit: number, endTime?: number): Promise<Bar[]> {
  return binanceKlines(SPOT_KLINES, symbol, interval, limit, endTime);
}

function fromBinanceFutures(symbol: string, interval: string, limit: number, endTime?: number): Promise<Bar[]> {
  return binanceKlines(FUTURES_KLINES, symbol, interval, limit, endTime);
}

/** Most Binance requests (1000 klines each) for one merged time frame, e.g. 30 s candles from 1 s klines. */
const MAX_PAGES = 5;

/** `endTime` (unix seconds): the candles up to that moment instead of the newest. */
async function binanceKlines(urls: string[], symbol: string, interval: string, limit: number, endTime?: number): Promise<Bar[]> {
  const source = binanceInterval(interval);
  if (!BINANCE_NATIVE.includes(source)) throw new Error(`Binance unterstützt ${interval} nicht`);
  const merged = source !== interval && interval !== "all";
  // Fixed-length merged time frames page back until there are enough source klines for `limit` candles.
  const ratio = merged && !isCalendarInterval(interval) ? intervalSeconds(interval) / intervalSeconds(source) : 1;
  const pages = merged ? Math.min(MAX_PAGES, Math.max(1, Math.ceil((limit * ratio) / 1000))) : 1;
  // Aggregated and full-history charts take as much history as Binance gives in one request.
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${source}&limit=${source === interval && interval !== "all" ? limit : 1000}`;
  let lastError: unknown;
  for (const url of urls) {
    try {
      let bars: Bar[] = [];
      for (let page = 0; page < pages; page++) {
        const end = bars.length ? `&endTime=${bars[0].time * 1000 - 1}` : endTime ? `&endTime=${Math.floor(endTime) * 1000 - 1}` : "";
        const rows = (await fetchJson(`${url}?${query}${end}`)) as unknown[][];
        const chunk = rows.map((r) => ({
          time: Math.floor(Number(r[0]) / 1000),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          volume: Number(r[5]),
          buyVolume: Number(r[9]),
        }));
        bars = [...chunk, ...bars];
        if (chunk.length < 1000) break;
      }
      return merged ? aggregate(bars, interval).slice(-limit) : bars;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** The exchange candle to merge a time frame from: its own when listed, months for quarters/years, else the largest that divides it. */
function venueBase(venue: Feed, interval: string): string | null {
  const codes = Object.keys(venue.intervals);
  if (codes.includes(interval)) return interval;
  if (isCalendarInterval(interval)) return codes.includes("1M") ? "1M" : "1d";
  if (interval === "all") return codes.includes("1w") ? "1w" : "1d";
  if (interval === "1w") return "1d";
  return baseInterval(interval, codes);
}

/** Monday 1970-01-05: weeks start on Monday as at the exchanges, not on the Thursday of the epoch. */
const MONDAY = 4 * 86400;

/** Candles of another crypto exchange, paged back and merged like Binance's. */
async function fromVenue(inst: Instrument, interval: string, limit: number, endTime?: number): Promise<Bar[]> {
  const venue = inst.feed;
  const base = venueBase(venue, interval);
  if (!base) throw new Error(`${inst.venue.name} hat keine Kerzen für ${interval}`);
  const code = venue.intervals[base];
  const merged = base !== interval && interval !== "all";
  const ratio = merged && !isCalendarInterval(interval) ? intervalSeconds(interval) / intervalSeconds(base) : 1;
  const wanted = interval === "all" || isCalendarInterval(interval) ? venue.maxLimit * MAX_PAGES : limit * ratio;
  const pages = venue.paging ? Math.min(MAX_PAGES, Math.max(1, Math.ceil(wanted / venue.maxLimit))) : 1;
  // A watchlist quote needs two candles, not a full page.
  const perRequest = pages > 1 ? venue.maxLimit : Math.min(venue.maxLimit, Math.ceil(wanted) + 2);
  let bars: Bar[] = [];
  // Once REST was blocked, the remaining pages go over the WebSocket too.
  let viaWs = false;
  const page = async (end: number | undefined): Promise<Bar[]> => {
    const ws = venue.wsHistory;
    if (!viaWs) {
      try {
        return venue.parseCandles(await fetchJson(venue.candlesUrl(inst.native, code, perRequest, end)));
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        if (!ws || !venue.wsUrl) throw new Error(blockedMessage(inst.venue.name));
        viaWs = true;
      }
    }
    // Kraken and Bitget only send their newest candles over the WebSocket: no older history.
    if (end !== undefined && !ws!.paging) return [];
    try {
      return await wsRequest(venue.wsUrl!, ws!.request(inst.wsNative ?? inst.native, base, perRequest, end), ws!.parse);
    } catch (e) {
      throw isNetworkError(e) || /WebSocket/.test(String((e as Error).message)) ? new Error(blockedMessage(inst.venue.name)) : e;
    }
  };
  for (let p = 0; p < pages; p++) {
    const end = bars.length ? bars[0].time : endTime ? Math.floor(endTime) : undefined;
    const chunk = (await page(end)).filter((b) => end === undefined || b.time < end);
    bars = [...chunk, ...bars];
    if (chunk.length < perRequest * 0.9) break;
  }
  if (!merged) return interval === "all" ? bars : bars.slice(-limit);
  const out =
    interval === "1w"
      ? aggregate(bars.map((b) => ({ ...b, time: b.time - MONDAY })), "1w").map((b) => ({ ...b, time: b.time + MONDAY }))
      : aggregate(bars, interval);
  return out.slice(-limit);
}

const YAHOO: Record<string, { interval: string; range: string; aggregate?: boolean }> = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "30m": { interval: "30m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "4h": { interval: "60m", range: "730d", aggregate: true },
  "1d": { interval: "1d", range: "10y" },
  "1w": { interval: "1wk", range: "max" },
  "1M": { interval: "1mo", range: "max", aggregate: true },
  "3M": { interval: "1mo", range: "max", aggregate: true },
  "1y": { interval: "1mo", range: "max", aggregate: true },
  all: { interval: "1wk", range: "max" },
};

interface YahooChart {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
  };
}

/** Yahoo candles for other time frames: the largest Yahoo interval that divides it, merged. */
const YAHOO_BASES: Record<string, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "30m": { interval: "30m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "1d": { interval: "1d", range: "10y" },
};

function yahooConfig(interval: string): { interval: string; range: string; aggregate?: boolean } | undefined {
  if (YAHOO[interval]) return YAHOO[interval];
  const base = baseInterval(interval, Object.keys(YAHOO_BASES));
  // Yahoo has nothing below a minute.
  return base ? { ...YAHOO_BASES[base], aggregate: true } : undefined;
}

async function fromYahoo(symbol: string, interval: string, limit: number): Promise<Bar[]> {
  const cfg = yahooConfig(interval);
  if (!cfg) throw new Error(`Yahoo unterstützt ${interval} nicht`);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${cfg.interval}&range=${cfg.range}`;
  const json = (await fetchJson(url)) as YahooChart;
  const result = json.chart.result?.[0];
  if (!result?.timestamp) throw new Error(`Yahoo: keine Daten für ${symbol}`);
  const q = result.indicators.quote[0];
  let bars: Bar[] = [];
  result.timestamp.forEach((t, i) => {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if (o === null || h === null || l === null || c === null) return;
    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
  });
  if (cfg.aggregate) bars = aggregate(bars, interval);
  // The full history is never cut off.
  return interval === "all" ? bars : bars.slice(-limit);
}

/** Merges smaller candles into candles of `interval` (fixed length or calendar). */
export function aggregate(bars: Bar[], interval: string): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const bucket = bucketTime(interval, b.time);
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
      if (last.buyVolume !== undefined && b.buyVolume !== undefined) last.buyVolume += b.buyVolume;
    } else {
      out.push({ ...b, time: bucket });
    }
  }
  return out;
}

// Deterministic random walk so the app is usable offline.
export function demoBars(symbol: string, interval: string, limit: number): Bar[] {
  let seed = [...symbol].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const step = intervalSeconds(interval);
  const end = Math.floor(Date.now() / 1000 / step) * step;
  let price = 50 + rand() * 450;
  const bars: Bar[] = [];
  let drift = 0;
  for (let i = limit - 1; i >= 0; i--) {
    if (rand() < 0.04) drift = (rand() - 0.5) * 0.004;
    const vol = 0.004 + rand() * 0.012;
    const open = price;
    const close = open * (1 + drift + (rand() - 0.5) * vol * 2);
    const high = Math.max(open, close) * (1 + rand() * vol);
    const low = Math.min(open, close) * (1 - rand() * vol);
    bars.push({ time: end - i * step, open, high, low, close, volume: Math.round(1000 + rand() * 9000 * (1 + Math.abs(close - open) / open * 50)) });
    price = close;
  }
  return bars;
}

// Aggregate trades for tick and range bars (sources in shared/tickBars.ts).
const SPOT_TRADES = ["https://api.binance.com/api/v3/aggTrades", "https://data-api.binance.vision/api/v3/aggTrades"];
const FUTURES_TRADES = ["https://fapi.binance.com/fapi/v1/aggTrades"];
const SPOT_INFO = ["https://api.binance.com/api/v3/exchangeInfo", "https://data-api.binance.vision/api/v3/exchangeInfo"];
/** Most aggTrades requests (1000 each) for one tick or range chart. */
const MAX_TRADE_PAGES = 10;

interface AggTrade {
  a: number;
  p: string;
  q: string;
  f: number;
  l: number;
  T: number;
  m: boolean;
}

export const aggTradeToTrade = (t: AggTrade): Trade => ({ timeMs: t.T, price: +t.p, qty: +t.q, count: t.l - t.f + 1, buy: !t.m });

/** The newest aggregate trades, paged back by id until `pages` requests are done; oldest first. */
async function binanceAggTrades(urls: string[], symbol: string, pages: number): Promise<AggTrade[]> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      let rows: AggTrade[] = [];
      for (let page = 0; page < pages; page++) {
        const from = rows.length ? rows[0].a - 1000 : null;
        if (from !== null && from < 0) break;
        const chunk = (await fetchJson(`${url}?symbol=${encodeURIComponent(symbol)}&limit=1000${from !== null ? `&fromId=${from}` : ""}`)) as AggTrade[];
        const older = rows.length ? chunk.filter((t) => t.a < rows[0].a) : chunk;
        rows = [...older, ...rows];
        if (chunk.length < 1000) break;
      }
      return rows;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Minimum price change from Binance spot (PRICE_FILTER.tickSize), or null. */
async function binanceTickSize(symbol: string): Promise<number | null> {
  for (const url of SPOT_INFO) {
    try {
      const info = (await fetchJson(`${url}?symbol=${encodeURIComponent(symbol)}`)) as { symbols?: { filters?: { filterType: string; tickSize?: string }[] }[] };
      const size = Number(info.symbols?.[0]?.filters?.find((f) => f.filterType === "PRICE_FILTER")?.tickSize);
      if (size > 0) return size;
    } catch {
      // next mirror
    }
  }
  return null;
}

/** Trade requests for about `limit` bars: ticks need limit × count trades, ranges as many as allowed. */
function tradePages(spec: TradeInterval, limit: number): number {
  return spec.kind === "ticks" ? Math.min(MAX_TRADE_PAGES, Math.max(1, Math.ceil((limit * spec.count) / 1000))) : MAX_TRADE_PAGES;
}

async function loadTradeBars(symbol: string, spec: TradeInterval, limit: number, futures: boolean): Promise<Omit<MarketData, "symbol" | "interval" | "source">> {
  const rows = await binanceAggTrades(futures ? FUTURES_TRADES : SPOT_TRADES, symbol, tradePages(spec, limit));
  const trades = rows.map(aggTradeToTrade);
  const tickSize = (!futures && spec.kind === "range" ? await binanceTickSize(symbol) : null) ?? tickSizeFromPrices(trades.map((t) => t.price));
  const bars = addTrades([], spec, tickSize, trades).slice(-limit);
  return { bars, tickSize, lastTradeId: rows.length ? rows[rows.length - 1].a : undefined };
}

/** `endTime` (unix seconds) loads older candles up to that moment; only Binance and other crypto exchanges support it, other sources return the newest. */
export async function loadMarketData(rawSymbol: string, interval: string, limit = 1000, endTime?: number): Promise<MarketData> {
  const symbol = stripBinance(rawSymbol.trim().toUpperCase());
  if (!isValidInterval(interval)) throw new Error(`Unbekannte Zeiteinheit: ${interval}`);
  const trade = parseTradeInterval(interval);
  if (trade) return loadTradeData(symbol, interval, trade, limit);
  // Another exchange is asked on its own: a pair it does not list is an error, not Binance's or demo prices.
  const venue = parseVenueSymbol(symbol);
  if (venue) {
    const what = `${venue.venue.name} ${KIND_LABEL[venue.kind]} ${venue.native}`;
    if (intervalSeconds(interval) < 60) throw new Error(`${what}: Sekunden-Kerzen gibt es nur bei Binance Spot`);
    const bars = await fromVenue(venue, interval, limit, endTime);
    if (bars.length === 0) throw new Error(`${what}: keine Kerzen`);
    return { symbol, interval, source: "venue", bars };
  }
  if (isVenuePrefixed(symbol)) throw new Error(`${symbol}: diesen Markt gibt es bei der Börse nicht (oder nicht öffentlich)`);
  const spot: [MarketData["source"], () => Promise<Bar[]>] = ["binance", () => fromBinance(symbol, interval, limit, endTime)];
  const futures: [MarketData["source"], () => Promise<Bar[]>] = ["binance_futures", () => fromBinanceFutures(symbol, interval, limit, endTime)];
  const yahoo: [MarketData["source"], () => Promise<Bar[]>] = ["yahoo", () => fromYahoo(symbol, interval, limit)];
  // XAUUSDT, CLUSDT, TSLAUSDT … only exist as Binance futures, so they come after spot.
  // Second candles exist only as Binance spot klines.
  const seconds = intervalSeconds(interval) < 60;
  const attempts = seconds ? (isCryptoSymbol(symbol) ? [spot] : []) : isCryptoSymbol(symbol) ? [spot, futures, yahoo] : [yahoo, spot];
  for (const [source, load] of attempts) {
    try {
      const bars = await load();
      if (bars.length > 0) return { symbol, interval, source, bars };
    } catch (err) {
      console.warn(`[market] ${source} ${symbol} ${interval}: ${(err as Error).message}`);
    }
  }
  return { symbol, interval, source: "demo", bars: demoBars(symbol, interval, Math.min(limit, 600)) };
}

/** Tick and range bars from Binance trades (spot, then USDⓈ-M futures); other symbols show demo trades. */
async function loadTradeData(symbol: string, interval: string, spec: TradeInterval, limit: number): Promise<MarketData> {
  if (isVenuePrefixed(symbol)) throw new Error("Ticks und Bereiche gibt es nur mit Binance-Spot- und USDⓈ-M-Kursen");
  if (isCryptoSymbol(symbol)) {
    for (const futures of [false, true]) {
      const source = futures ? "binance_futures" : "binance";
      try {
        const data = await loadTradeBars(symbol, spec, limit, futures);
        if (data.bars.length > 0) return { symbol, interval, source, ...data };
      } catch (err) {
        console.warn(`[market] ${source} ${symbol} ${interval}: ${(err as Error).message}`);
      }
    }
  }
  const trades = demoTrades(symbol, Math.min(20_000, spec.kind === "ticks" ? spec.count * 400 : 20_000));
  return { symbol, interval, source: "demo", tickSize: 0.01, bars: addTrades([], spec, 0.01, trades).slice(-Math.min(limit, 600)) };
}

export interface OpenInterestPoint {
  time: number; // unix seconds
  value: number; // open interest in quote currency (USDT)
}

/** Open-interest history from Binance USDⓈ-M futures (≈ last 30 days, max 500 points). */
export async function loadOpenInterest(rawSymbol: string, period: string, limit = 500): Promise<OpenInterestPoint[]> {
  const symbol = rawSymbol.trim().toUpperCase();
  const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${Math.min(500, limit)}`;
  const rows = (await fetchJson(url)) as { sumOpenInterestValue: string; timestamp: number }[];
  return rows.map((r) => ({ time: Math.floor(r.timestamp / 1000), value: Number(r.sumOpenInterestValue) })).filter((p) => p.value > 0);
}
