/**
 * Crypto rankings like CoinMarketCap: every coin by market capitalisation with price, volume, changes and supply,
 * plus the whole market (total market cap, volume, BTC/ETH dominance).
 *
 * CoinMarketCap's own API needs a key and does not allow calls from a browser (no CORS), so ChartAI reads the
 * same kind of figures from public APIs that do:
 * - CoinGecko API v3 (main source): GET /coins/markets (market_cap_rank, current_price, market_cap, total_volume,
 *   price_change_percentage_{1h,24h,7d,30d}_in_currency, circulating/total/max_supply, ath, sparkline_in_7d)
 *   and GET /global (total_market_cap, total_volume, market_cap_percentage, market_cap_change_percentage_24h_usd).
 *   https://docs.coingecko.com/v3.0.1/reference/coins-markets, https://docs.coingecko.com/v3.0.1/reference/crypto-global
 * - CoinPaprika API v1 (fallback when CoinGecko refuses, e.g. its rate limit): GET /tickers?quotes=USD,EUR and
 *   GET /global (market_cap_usd, volume_24h_usd, bitcoin_dominance_percentage). https://api.coinpaprika.com/
 * Dominance is a coin's share of the total market capitalisation (market cap ÷ total market cap).
 */

export type RankCurrency = "usd" | "eur";
export type RankSource = "coingecko" | "coinpaprika" | "sample";

export interface CoinRow {
  id: string;
  rank: number;
  /** Ticker in capitals, e.g. BTC. */
  symbol: string;
  name: string;
  image: string | null;
  price: number;
  marketCap: number;
  fdv: number | null;
  volume: number;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  high24h: number | null;
  low24h: number | null;
  circulating: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  ath: number | null;
  /** Percent below (−) the all-time high. */
  athChangePct: number | null;
  /** Prices over the last 7 days (CoinGecko only), oldest first. */
  sparkline: number[];
}

export interface GlobalStats {
  marketCap: number;
  volume: number;
  /** Percent of the total market cap. */
  btcDominance: number | null;
  ethDominance: number | null;
  marketCapChange24h: number | null;
  coins: number | null;
}

export interface RankingData {
  coins: CoinRow[];
  global: GlobalStats | null;
  source: RankSource;
  currency: RankCurrency;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Rows from CoinGecko's /coins/markets answer (sparkline=true, price_change_percentage=1h,24h,7d,30d). */
export function parseCoinGeckoMarkets(raw: unknown): CoinRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: CoinRow[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    const rank = num(c.market_cap_rank);
    const price = num(c.current_price);
    if (rank === null || price === null) continue;
    const spark = (c.sparkline_in_7d as { price?: unknown } | undefined)?.price;
    rows.push({
      id: String(c.id ?? ""),
      rank,
      symbol: String(c.symbol ?? "").toUpperCase(),
      name: String(c.name ?? ""),
      image: typeof c.image === "string" ? c.image : null,
      price,
      marketCap: num(c.market_cap) ?? 0,
      fdv: num(c.fully_diluted_valuation),
      volume: num(c.total_volume) ?? 0,
      change1h: num(c.price_change_percentage_1h_in_currency),
      change24h: num(c.price_change_percentage_24h_in_currency) ?? num(c.price_change_percentage_24h),
      change7d: num(c.price_change_percentage_7d_in_currency),
      change30d: num(c.price_change_percentage_30d_in_currency),
      high24h: num(c.high_24h),
      low24h: num(c.low_24h),
      circulating: num(c.circulating_supply),
      totalSupply: num(c.total_supply),
      maxSupply: num(c.max_supply),
      ath: num(c.ath),
      athChangePct: num(c.ath_change_percentage),
      sparkline: Array.isArray(spark) ? spark.map(Number).filter(Number.isFinite) : [],
    });
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

/** CoinGecko's /global answer in one currency. */
export function parseCoinGeckoGlobal(raw: unknown, currency: RankCurrency): GlobalStats | null {
  const d = (raw as { data?: Record<string, unknown> } | null)?.data;
  if (!d) return null;
  const cap = num((d.total_market_cap as Record<string, unknown> | undefined)?.[currency]);
  const vol = num((d.total_volume as Record<string, unknown> | undefined)?.[currency]);
  if (cap === null || vol === null) return null;
  const share = (d.market_cap_percentage ?? {}) as Record<string, unknown>;
  return {
    marketCap: cap,
    volume: vol,
    btcDominance: num(share.btc),
    ethDominance: num(share.eth),
    marketCapChange24h: num(d.market_cap_change_percentage_24h_usd),
    coins: num(d.active_cryptocurrencies),
  };
}

/** Rows from CoinPaprika's /tickers answer (quotes=USD,EUR); `limit` keeps the first ranks. */
export function parseCoinPaprikaTickers(raw: unknown, currency: RankCurrency, limit = Infinity): CoinRow[] {
  if (!Array.isArray(raw)) return [];
  const key = currency.toUpperCase();
  const rows: CoinRow[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    const rank = num(c.rank);
    const q = (c.quotes as Record<string, Record<string, unknown>> | undefined)?.[key];
    const price = num(q?.price);
    // Rank 0 marks coins CoinPaprika does not rank (no market cap).
    if (!rank || !q || price === null) continue;
    rows.push({
      id: String(c.id ?? ""),
      rank,
      symbol: String(c.symbol ?? "").toUpperCase(),
      name: String(c.name ?? ""),
      image: null,
      price,
      marketCap: num(q.market_cap) ?? 0,
      fdv: num(q.fully_diluted_market_cap),
      volume: num(q.volume_24h) ?? 0,
      change1h: num(q.percent_change_1h),
      change24h: num(q.percent_change_24h),
      change7d: num(q.percent_change_7d),
      change30d: num(q.percent_change_30d),
      high24h: null,
      low24h: null,
      circulating: num(c.circulating_supply),
      totalSupply: num(c.total_supply),
      maxSupply: num(c.max_supply) || null,
      ath: num(q.ath_price),
      athChangePct: num(q.percent_from_price_ath),
      sparkline: [],
    });
  }
  return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/**
 * CoinPaprika's /global answer (USD only). For EUR it is converted with the ratio of a coin's EUR and USD price
 * from the tickers (`usdToCurrency`); ETH dominance is computed from the ETH row.
 */
export function parseCoinPaprikaGlobal(raw: unknown, usdToCurrency = 1, ethMarketCap: number | null = null): GlobalStats | null {
  const d = raw as Record<string, unknown> | null;
  const cap = num(d?.market_cap_usd);
  const vol = num(d?.volume_24h_usd);
  if (!d || cap === null || vol === null || cap <= 0) return null;
  const marketCap = cap * usdToCurrency;
  return {
    marketCap,
    volume: vol * usdToCurrency,
    btcDominance: num(d.bitcoin_dominance_percentage),
    ethDominance: ethMarketCap === null ? null : (ethMarketCap / marketCap) * 100,
    marketCapChange24h: num(d.market_cap_change_24h),
    coins: num(d.cryptocurrencies_number),
  };
}

/** EUR per USD from CoinPaprika tickers, read off the first coin that has both quotes. */
export function paprikaUsdToEur(raw: unknown): number {
  if (!Array.isArray(raw)) return 1;
  for (const c of raw as Record<string, unknown>[]) {
    const q = c.quotes as Record<string, Record<string, unknown>> | undefined;
    const usd = num(q?.USD?.price);
    const eur = num(q?.EUR?.price);
    if (usd && eur) return eur / usd;
  }
  return 1;
}

// ---------------- list view ----------------

export type RankSort = "rank" | "name" | "price" | "change1h" | "change24h" | "change7d" | "change30d" | "marketCap" | "volume" | "volumeShare" | "circulating";
export type RankView = "all" | "gainers" | "losers" | "watch";

export interface RankFilter {
  query: string;
  view: RankView;
  /** Gainers and losers ignore coins below this 24 h volume (like CoinMarketCap's default). */
  minVolume: number;
}

export const DEFAULT_RANK_FILTER: RankFilter = { query: "", view: "all", minVolume: 50_000 };

/** Stablecoins have no chart against USDT. */
const STABLE = new Set(["USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE", "USDS", "PYUSD", "USDD", "BUSD", "USD1", "USDP", "GUSD", "FRAX", "LUSD", "EURC", "USDTB", "RLUSD", "USDF", "USD0", "SUSDS", "SUSDE", "BSC-USD"]);

export function isStablecoin(symbol: string): boolean {
  return STABLE.has(symbol.toUpperCase());
}

/**
 * Chart symbol of each coin: its Binance USDT pair. Several coins share a ticker, so only the best ranked one
 * gets it. With `listed` (Binance's pairs) coins that Binance does not list get none.
 */
export function chartSymbols(coins: CoinRow[], listed?: Set<string> | null): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const c of [...coins].sort((a, b) => a.rank - b.rank)) {
    if (isStablecoin(c.symbol) || !/^[A-Z0-9]{2,12}$/.test(c.symbol)) continue;
    const pair = `${c.symbol}USDT`;
    if (taken.has(pair)) continue;
    taken.add(pair);
    if (listed && listed.size && !listed.has(pair)) continue;
    out.set(c.id, pair);
  }
  return out;
}

/** Volume as a share of market cap in percent (CoinMarketCap's "Volume / Market Cap"). */
export function volumeShare(c: CoinRow): number | null {
  return c.marketCap > 0 ? (c.volume / c.marketCap) * 100 : null;
}

const sortValue = (c: CoinRow, key: RankSort): number | string | null => {
  if (key === "name") return c.name.toLowerCase();
  if (key === "volumeShare") return volumeShare(c);
  return c[key];
};

/** Filtered and sorted list. Gainers/losers sort by 24 h change and leave out thinly traded coins. */
export function rankList(coins: CoinRow[], filter: RankFilter, sort: RankSort, desc: boolean, watch: Set<string> = new Set(), symbols: Map<string, string> = new Map()): CoinRow[] {
  const q = filter.query.trim().toLowerCase();
  let list = coins.filter((c) => !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  if (filter.view === "watch") list = list.filter((c) => watch.has(symbols.get(c.id) ?? ""));
  if (filter.view === "gainers" || filter.view === "losers") {
    list = list.filter((c) => c.change24h !== null && c.volume >= filter.minVolume && !isStablecoin(c.symbol));
    if (sort === "rank") {
      sort = "change24h";
      desc = filter.view === "gainers";
    }
  }
  const dir = desc ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, sort);
    const vb = sortValue(b, sort);
    // Missing values always go last.
    if (va === null && vb === null) return a.rank - b.rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va === vb) return a.rank - b.rank;
    return (va < vb ? -1 : 1) * dir;
  });
}

// ---------------- sample data ----------------

/** Illustrative example figures (not real prices) for when no source answers; the app marks them as Beispieldaten. */
export function sampleRanking(currency: RankCurrency = "usd"): RankingData {
  const fx = currency === "eur" ? 0.92 : 1;
  const base: [string, string, string, number, number, number, number, number, number, number | null][] = [
    // id, symbol, name, price, market cap, volume, 1h, 24h, 7d, max supply
    ["bitcoin", "BTC", "Bitcoin", 68000, 1.34e12, 3.2e10, 0.2, 1.4, 4.1, 21e6],
    ["ethereum", "ETH", "Ethereum", 2600, 3.13e11, 1.5e10, -0.1, -0.8, 2.3, null],
    ["tether", "USDT", "Tether", 1, 1.2e11, 5.1e10, 0, 0.01, 0, null],
    ["binancecoin", "BNB", "BNB", 590, 8.6e10, 1.6e9, 0.3, 2.1, 5.2, 2e8],
    ["solana", "SOL", "Solana", 165, 7.7e10, 3.1e9, 0.5, 4.8, 11.3, null],
    ["usd-coin", "USDC", "USDC", 1, 3.4e10, 6.2e9, 0, -0.02, 0, null],
    ["ripple", "XRP", "XRP", 0.53, 3e10, 1.1e9, -0.2, -1.6, -3.4, 1e11],
    ["dogecoin", "DOGE", "Dogecoin", 0.14, 2e10, 1.4e9, 0.8, 6.2, 18.5, null],
    ["cardano", "ADA", "Cardano", 0.35, 1.25e10, 3.2e8, -0.3, -2.4, -1.1, 45e9],
    ["tron", "TRX", "TRON", 0.16, 1.39e10, 4.3e8, 0.1, 0.4, 0.9, null],
  ];
  const coins: CoinRow[] = base.map(([id, symbol, name, price, cap, vol, h1, h24, d7, max], i) => ({
    id,
    rank: i + 1,
    symbol,
    name,
    image: null,
    price: price * fx,
    marketCap: cap * fx,
    fdv: max ? price * max * fx : null,
    volume: vol * fx,
    change1h: h1,
    change24h: h24,
    change7d: d7,
    change30d: d7 * 1.8,
    high24h: price * 1.02 * fx,
    low24h: price * 0.97 * fx,
    circulating: cap / price,
    totalSupply: cap / price,
    maxSupply: max,
    ath: price * 1.25 * fx,
    athChangePct: -20,
    sparkline: Array.from({ length: 24 }, (_, k) => price * fx * (1 - d7 / 100 + (d7 / 100) * (k / 23) + Math.sin(k + i) * 0.01)),
  }));
  const total = 2.4e12 * fx;
  return {
    coins,
    global: { marketCap: total, volume: 9e10 * fx, btcDominance: (1.34e12 * fx * 100) / total, ethDominance: (3.13e11 * fx * 100) / total, marketCapChange24h: 1.1, coins: 15000 },
    source: "sample",
    currency,
  };
}
