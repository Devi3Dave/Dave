import type { Bar } from "./math.js";

export interface MarketData {
  symbol: string;
  interval: string;
  source: "binance" | "yahoo" | "demo";
  bars: Bar[];
}

export const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

const CRYPTO_QUOTES = /^[A-Z0-9]{2,}(USDT|USDC|FDUSD|BUSD|BTC|ETH|BNB|EUR|TRY)$/;

export function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_QUOTES.test(symbol);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    // Browsers set their own User-Agent; only the Node server needs one for Yahoo.
    headers: typeof window === "undefined" ? { "User-Agent": "Mozilla/5.0 (tradingview-claude)" } : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fromBinance(symbol: string, interval: string, limit: number): Promise<Bar[]> {
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  // data-api.binance.vision is Binance's public market-data mirror; it also
  // works from regions where api.binance.com answers 451.
  let lastError: unknown;
  for (const host of ["https://api.binance.com", "https://data-api.binance.vision"]) {
    try {
      const rows = (await fetchJson(`${host}/api/v3/klines?${query}`)) as unknown[][];
      return rows.map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        buyVolume: Number(r[9]),
      }));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

const YAHOO: Record<string, { interval: string; range: string; aggregate?: number }> = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "30m": { interval: "30m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "4h": { interval: "60m", range: "730d", aggregate: 4 },
  "1d": { interval: "1d", range: "10y" },
  "1w": { interval: "1wk", range: "max" },
};

interface YahooChart {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
  };
}

async function fromYahoo(symbol: string, interval: string, limit: number): Promise<Bar[]> {
  const cfg = YAHOO[interval];
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
  if (cfg.aggregate) bars = aggregate(bars, INTERVAL_SECONDS[interval]);
  return bars.slice(-limit);
}

function aggregate(bars: Bar[], seconds: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const bucket = Math.floor(b.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
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
  const step = INTERVAL_SECONDS[interval] ?? 3600;
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

export async function loadMarketData(rawSymbol: string, interval: string, limit = 1000): Promise<MarketData> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!(interval in INTERVAL_SECONDS)) throw new Error(`Unbekannte Zeiteinheit: ${interval}`);
  const attempts: [MarketData["source"], () => Promise<Bar[]>][] = isCryptoSymbol(symbol)
    ? [["binance", () => fromBinance(symbol, interval, limit)], ["yahoo", () => fromYahoo(symbol, interval, limit)]]
    : [["yahoo", () => fromYahoo(symbol, interval, limit)], ["binance", () => fromBinance(symbol, interval, limit)]];
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
