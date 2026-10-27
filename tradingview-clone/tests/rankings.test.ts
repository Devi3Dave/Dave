import { describe, expect, it } from "vitest";
import {
  chartSymbols,
  DEFAULT_RANK_FILTER,
  paprikaUsdToEur,
  parseCoinGeckoGlobal,
  parseCoinGeckoMarkets,
  parseCoinPaprikaGlobal,
  parseCoinPaprikaTickers,
  rankList,
  sampleRanking,
  volumeShare,
} from "../shared/rankings";

// Shapes as documented at docs.coingecko.com (coins/markets, global) and api.coinpaprika.com (tickers, global).
const gecko = (id: string, symbol: string, rank: number | null, price: number, cap: number, vol: number, ch24: number) => ({
  id,
  symbol,
  name: id[0].toUpperCase() + id.slice(1),
  image: `https://example.test/${id}.png`,
  current_price: price,
  market_cap: cap,
  market_cap_rank: rank,
  fully_diluted_valuation: null,
  total_volume: vol,
  high_24h: price * 1.1,
  low_24h: price * 0.9,
  price_change_percentage_24h: ch24,
  circulating_supply: cap / price,
  total_supply: null,
  max_supply: 21000000,
  ath: price * 2,
  ath_change_percentage: -50,
  sparkline_in_7d: { price: [1, 2, 3] },
  price_change_percentage_1h_in_currency: 0.1,
  price_change_percentage_24h_in_currency: ch24,
  price_change_percentage_7d_in_currency: 5,
  price_change_percentage_30d_in_currency: null,
});

const markets = [
  gecko("ethereum", "eth", 2, 2500, 3e11, 1e10, -2),
  gecko("bitcoin", "btc", 1, 60000, 1.2e12, 3e10, 1),
  gecko("tether", "usdt", 3, 1, 1e11, 5e10, 0),
  gecko("pepe", "pepe", 30, 0.00001, 4e9, 1e9, 20),
  gecko("tiny", "tiny", 900, 1, 1e6, 100, 80),
  gecko("unranked", "unr", null, 1, 0, 0, 0),
  gecko("fake-eth", "eth", 700, 1, 1e6, 1e5, 3),
];

describe("CoinGecko", () => {
  const rows = parseCoinGeckoMarkets(markets);
  it("reads coins by rank and skips unranked ones", () => {
    expect(rows.map((r) => r.symbol)).toEqual(["BTC", "ETH", "USDT", "PEPE", "ETH", "TINY"]);
    const btc = rows[0];
    expect(btc).toMatchObject({ rank: 1, price: 60000, marketCap: 1.2e12, change24h: 1, change7d: 5, change30d: null, maxSupply: 21e6, athChangePct: -50 });
    expect(btc.sparkline).toEqual([1, 2, 3]);
    expect(parseCoinGeckoMarkets({ error: "x" })).toEqual([]);
  });
  it("reads the global figures in the chosen currency", () => {
    const raw = { data: { active_cryptocurrencies: 15000, total_market_cap: { usd: 2.4e12, eur: 2.2e12 }, total_volume: { usd: 9e10, eur: 8e10 }, market_cap_percentage: { btc: 55.5, eth: 12.1 }, market_cap_change_percentage_24h_usd: -1.2 } };
    expect(parseCoinGeckoGlobal(raw, "eur")).toEqual({ marketCap: 2.2e12, volume: 8e10, btcDominance: 55.5, ethDominance: 12.1, marketCapChange24h: -1.2, coins: 15000 });
    expect(parseCoinGeckoGlobal({}, "usd")).toBeNull();
  });
});

describe("CoinPaprika", () => {
  const tickers = [
    { id: "eth-ethereum", name: "Ethereum", symbol: "ETH", rank: 2, circulating_supply: 1.2e8, total_supply: 1.2e8, max_supply: 0, quotes: { USD: { price: 2500, volume_24h: 1e10, market_cap: 3e11, percent_change_1h: 0, percent_change_24h: -2, percent_change_7d: 1, percent_change_30d: 4, ath_price: 4800, percent_from_price_ath: -48 }, EUR: { price: 2300, volume_24h: 9e9, market_cap: 2.76e11, percent_change_24h: -2 } } },
    { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, circulating_supply: 2e7, max_supply: 21e6, quotes: { USD: { price: 60000, market_cap: 1.2e12, volume_24h: 3e10, percent_change_24h: 1 }, EUR: { price: 55200, market_cap: 1.104e12, volume_24h: 2.76e10, percent_change_24h: 1 } } },
    { id: "x-unranked", name: "X", symbol: "X", rank: 0, quotes: { USD: { price: 1 } } },
  ];
  it("reads tickers in the chosen currency, by rank, limited", () => {
    const rows = parseCoinPaprikaTickers(tickers, "eur");
    expect(rows.map((r) => r.id)).toEqual(["btc-bitcoin", "eth-ethereum"]);
    expect(rows[1]).toMatchObject({ price: 2300, marketCap: 2.76e11, maxSupply: null });
    expect(parseCoinPaprikaTickers(tickers, "usd", 1)).toHaveLength(1);
  });
  it("converts the USD global figures and computes ETH dominance", () => {
    const fx = paprikaUsdToEur(tickers);
    expect(fx).toBeCloseTo(0.92);
    const g = parseCoinPaprikaGlobal({ market_cap_usd: 2.4e12, volume_24h_usd: 9e10, bitcoin_dominance_percentage: 50, cryptocurrencies_number: 9000, market_cap_change_24h: 0.5 }, fx, 2.76e11)!;
    expect(g.marketCap).toBeCloseTo(2.208e12);
    expect(g.ethDominance).toBeCloseTo(12.5);
    expect(g.btcDominance).toBe(50);
    expect(parseCoinPaprikaGlobal(null)).toBeNull();
  });
});

describe("list view", () => {
  const rows = parseCoinGeckoMarkets(markets);
  it("gives the best ranked coin of a ticker its Binance pair, no stablecoins, only listed pairs", () => {
    const all = chartSymbols(rows);
    expect(all.get("ethereum")).toBe("ETHUSDT");
    expect(all.has("fake-eth")).toBe(false);
    expect(all.has("tether")).toBe(false);
    const listed = chartSymbols(rows, new Set(["BTCUSDT", "ETHUSDT"]));
    expect([...listed.values()]).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
  it("searches by name or ticker", () => {
    expect(rankList(rows, { ...DEFAULT_RANK_FILTER, query: "bit" }, "rank", false).map((r) => r.id)).toEqual(["bitcoin"]);
    expect(rankList(rows, { ...DEFAULT_RANK_FILTER, query: "PEPE" }, "rank", false).map((r) => r.id)).toEqual(["pepe"]);
  });
  it("gainers and losers sort by 24 h and leave out stablecoins and thin volume", () => {
    expect(rankList(rows, { ...DEFAULT_RANK_FILTER, view: "gainers" }, "rank", false).map((r) => r.id)).toEqual(["pepe", "fake-eth", "bitcoin", "ethereum"]);
    expect(rankList(rows, { ...DEFAULT_RANK_FILTER, view: "losers" }, "rank", false)[0].id).toBe("ethereum");
  });
  it("sorts by a column with missing values last, and filters the watchlist", () => {
    expect(rankList(rows, DEFAULT_RANK_FILTER, "marketCap", true).map((r) => r.id).slice(0, 2)).toEqual(["bitcoin", "ethereum"]);
    expect(rankList(rows, DEFAULT_RANK_FILTER, "change30d", true)[0].rank).toBe(1);
    const symbols = chartSymbols(rows);
    expect(rankList(rows, { ...DEFAULT_RANK_FILTER, view: "watch" }, "rank", false, new Set(["ETHUSDT"]), symbols).map((r) => r.id)).toEqual(["ethereum"]);
  });
  it("volume share and sample data", () => {
    expect(volumeShare(rows[0])).toBeCloseTo(2.5);
    const s = sampleRanking("eur");
    expect(s.source).toBe("sample");
    expect(s.coins[0].symbol).toBe("BTC");
    expect(s.global!.btcDominance).toBeGreaterThan(50);
  });
});
