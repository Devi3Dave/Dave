/**
 * Crypto screener: every Binance spot pair against USDT with its 24-hour statistics, filtered and sorted like
 * TradingView's crypto screener, plus technical columns from daily candles.
 *
 * Sources: Binance Spot API "24hr ticker price change statistics" (GET /api/v3/ticker/24hr; priceChangePercent,
 * quoteVolume, highPrice, lowPrice, count). RSI is Wilder's RSI(14) from shared/math.ts; the distance to the
 * 50/200-day SMA uses the daily closes.
 */
import { rsi, sma, type Bar } from "./math.js";

export interface ScreenerRow {
  symbol: string;
  /** The coin without the quote currency (BTC for BTCUSDT). */
  base: string;
  price: number;
  changePct: number;
  /** 24 h volume in USDT. */
  quoteVolume: number;
  high: number;
  low: number;
  /** Where the price sits in the 24 h range: 0 at the low, 100 at the high. */
  rangePct: number;
  trades: number;
}

export interface ScreenerTechnicals {
  rsi: number | null;
  /** Percent above (+) or below (−) the 50- and 200-day SMA. */
  sma50Pct: number | null;
  sma200Pct: number | null;
  /** Change over 7 and 30 days in percent. */
  week: number | null;
  month: number | null;
}

/** Leveraged tokens and stablecoin pairs are left out (as TradingView's default crypto screener does with its filters). */
const EXCLUDED = /(UP|DOWN|BULL|BEAR)USDT$/;
const STABLE = new Set(["USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "USDPUSDT", "DAIUSDT", "EURUSDT", "AEURUSDT", "USD1USDT"]);

/** Rows from the raw /api/v3/ticker/24hr answer: USDT pairs that traded in the last 24 h. */
export function parseTickers(raw: unknown): ScreenerRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: ScreenerRow[] = [];
  for (const t of raw as Record<string, unknown>[]) {
    const symbol = String(t.symbol ?? "");
    if (!symbol.endsWith("USDT") || EXCLUDED.test(symbol) || STABLE.has(symbol)) continue;
    const price = Number(t.lastPrice);
    const high = Number(t.highPrice);
    const low = Number(t.lowPrice);
    const quoteVolume = Number(t.quoteVolume);
    const trades = Number(t.count);
    // Delisted pairs still answer, with no trades and a price of 0.
    if (!(price > 0) || !(quoteVolume > 0) || !(trades > 0)) continue;
    rows.push({
      symbol,
      base: symbol.slice(0, -4),
      price,
      changePct: Number(t.priceChangePercent) || 0,
      quoteVolume,
      high,
      low,
      rangePct: high > low ? ((price - low) / (high - low)) * 100 : 50,
      trades,
    });
  }
  return rows;
}

export type ScreenerSort = "symbol" | "price" | "changePct" | "quoteVolume" | "rangePct" | "trades" | "rsi" | "sma50Pct" | "sma200Pct" | "week" | "month";

export interface ScreenerFilter {
  query: string;
  /** Minimum 24 h volume in USDT. */
  minVolume: number;
  /** "gainers"/"losers": only rising/falling pairs; "all": both. */
  direction: "all" | "gainers" | "losers";
  /** RSI filter (needs the technical columns): oversold < 30, overbought > 70. */
  rsi: "all" | "oversold" | "overbought";
  /** Price above the 200-day SMA (uptrend) or below it. */
  trend: "all" | "above200" | "below200";
}

export const DEFAULT_FILTER: ScreenerFilter = { query: "", minVolume: 1_000_000, direction: "all", rsi: "all", trend: "all" };

/** Filters and sorts; pairs without a value in the sort column go last. */
export function screen(
  rows: ScreenerRow[],
  tech: Record<string, ScreenerTechnicals>,
  filter: ScreenerFilter,
  sort: ScreenerSort,
  desc: boolean,
): ScreenerRow[] {
  const q = filter.query.trim().toUpperCase();
  const out = rows.filter((r) => {
    if (q && !r.symbol.includes(q)) return false;
    if (r.quoteVolume < filter.minVolume) return false;
    if (filter.direction === "gainers" && !(r.changePct > 0)) return false;
    if (filter.direction === "losers" && !(r.changePct < 0)) return false;
    const t = tech[r.symbol];
    if (filter.rsi !== "all" && (t?.rsi == null || (filter.rsi === "oversold" ? t.rsi >= 30 : t.rsi <= 70))) return false;
    if (filter.trend !== "all" && (t?.sma200Pct == null || (filter.trend === "above200" ? t.sma200Pct <= 0 : t.sma200Pct >= 0))) return false;
    return true;
  });
  const value = (r: ScreenerRow): number | string | null =>
    sort === "symbol" ? r.symbol : sort in r ? (r[sort as keyof ScreenerRow] as number) : (tech[r.symbol]?.[sort as keyof ScreenerTechnicals] ?? null);
  return out.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return desc ? -c : c;
  });
}

const pct = (a: number, b: number | null) => (b === null || !(b > 0) ? null : ((a - b) / b) * 100);

/** Technical columns from daily candles (oldest first, the last one may still be running). */
export function technicals(daily: Bar[]): ScreenerTechnicals {
  const closes = daily.map((b) => b.close);
  const last = closes[closes.length - 1];
  if (last === undefined) return { rsi: null, sma50Pct: null, sma200Pct: null, week: null, month: null };
  const lastOf = (s: (number | null)[]) => s[s.length - 1] ?? null;
  const ago = (n: number) => (closes.length > n ? closes[closes.length - 1 - n] : null);
  return {
    rsi: lastOf(rsi(closes, 14)),
    sma50Pct: pct(last, lastOf(sma(closes, 50))),
    sma200Pct: pct(last, lastOf(sma(closes, 200))),
    week: pct(last, ago(7)),
    month: pct(last, ago(30)),
  };
}
