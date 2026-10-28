/** Asset catalog for the symbol picker: popular assets by category and where their prices come from. */

import { feedSymbol } from "./exchangeFeed.js";
import { parseVenueSymbol } from "./venues.js";

export type AssetCategory = "Krypto" | "Aktien" | "Indizes & ETFs" | "Edelmetalle" | "Rohstoffe" | "Forex";

export const ASSET_CATEGORIES: AssetCategory[] = ["Krypto", "Aktien", "Indizes & ETFs", "Edelmetalle", "Rohstoffe", "Forex"];

export interface Asset {
  /** Catalog id: the Binance spot pair for crypto, otherwise the Yahoo symbol. */
  id: string;
  name: string;
  category: AssetCategory;
  /** Binance USDⓈ-M perpetual that tracks the asset (gold, oil, US stocks …), used where Yahoo is unreachable. */
  perp?: string;
}

const crypto = (base: string, name: string): Asset => ({ id: `${base}USDT`, name, category: "Krypto" });
const stock = (id: string, name: string, perp = true): Asset => ({ id, name, category: "Aktien", ...(perp ? { perp: `${id}USDT` } : {}) });

export const ASSETS: Asset[] = [
  crypto("BTC", "Bitcoin"),
  crypto("ETH", "Ethereum"),
  crypto("SOL", "Solana"),
  crypto("BNB", "BNB"),
  crypto("XRP", "XRP"),
  crypto("DOGE", "Dogecoin"),
  crypto("ADA", "Cardano"),
  crypto("TRX", "TRON"),
  crypto("AVAX", "Avalanche"),
  crypto("LINK", "Chainlink"),
  crypto("TON", "Toncoin"),
  crypto("SUI", "Sui"),
  crypto("DOT", "Polkadot"),
  crypto("LTC", "Litecoin"),
  crypto("BCH", "Bitcoin Cash"),
  crypto("XLM", "Stellar"),
  crypto("HBAR", "Hedera"),
  crypto("SHIB", "Shiba Inu"),
  crypto("PEPE", "Pepe"),
  crypto("NEAR", "NEAR Protocol"),
  crypto("APT", "Aptos"),
  crypto("UNI", "Uniswap"),
  crypto("AAVE", "Aave"),
  crypto("ATOM", "Cosmos"),
  crypto("ETC", "Ethereum Classic"),
  crypto("ARB", "Arbitrum"),
  crypto("OP", "Optimism"),
  crypto("INJ", "Injective"),
  crypto("TAO", "Bittensor"),
  crypto("FET", "Artificial Superintelligence"),
  crypto("RENDER", "Render"),
  crypto("ENA", "Ethena"),
  crypto("WLD", "Worldcoin"),

  stock("AAPL", "Apple"),
  stock("MSFT", "Microsoft"),
  stock("NVDA", "NVIDIA"),
  stock("AMZN", "Amazon"),
  stock("GOOGL", "Alphabet (Google)"),
  stock("META", "Meta Platforms"),
  stock("TSLA", "Tesla"),
  stock("AVGO", "Broadcom"),
  stock("NFLX", "Netflix"),
  stock("AMD", "AMD"),
  stock("INTC", "Intel"),
  stock("ORCL", "Oracle"),
  stock("PLTR", "Palantir"),
  stock("COIN", "Coinbase"),
  stock("MSTR", "Strategy (MicroStrategy)"),
  stock("HOOD", "Robinhood"),
  stock("CRCL", "Circle"),
  stock("JPM", "JPMorgan Chase"),
  stock("V", "Visa", false),
  stock("XOM", "ExxonMobil"),
  stock("BABA", "Alibaba"),
  stock("SAP.DE", "SAP", false),
  stock("SIE.DE", "Siemens", false),
  stock("ALV.DE", "Allianz", false),
  stock("DTE.DE", "Deutsche Telekom", false),
  stock("RHM.DE", "Rheinmetall", false),
  stock("MBG.DE", "Mercedes-Benz", false),
  stock("BMW.DE", "BMW", false),
  stock("VOW3.DE", "Volkswagen", false),
  stock("BAS.DE", "BASF", false),
  stock("ADS.DE", "adidas", false),

  { id: "^GSPC", name: "S&P 500", category: "Indizes & ETFs", perp: "SPYUSDT" },
  { id: "^NDX", name: "Nasdaq 100", category: "Indizes & ETFs", perp: "QQQUSDT" },
  { id: "^DJI", name: "Dow Jones", category: "Indizes & ETFs" },
  { id: "^GDAXI", name: "DAX", category: "Indizes & ETFs" },
  { id: "^STOXX50E", name: "Euro Stoxx 50", category: "Indizes & ETFs" },
  { id: "^FTSE", name: "FTSE 100", category: "Indizes & ETFs" },
  { id: "^N225", name: "Nikkei 225", category: "Indizes & ETFs" },
  { id: "^VIX", name: "VIX Volatilitätsindex", category: "Indizes & ETFs" },

  { id: "GC=F", name: "Gold", category: "Edelmetalle", perp: "XAUUSDT" },
  { id: "SI=F", name: "Silber", category: "Edelmetalle", perp: "XAGUSDT" },
  { id: "PL=F", name: "Platin", category: "Edelmetalle", perp: "XPTUSDT" },
  { id: "PA=F", name: "Palladium", category: "Edelmetalle", perp: "XPDUSDT" },
  { id: "PAXGUSDT", name: "PAX Gold (Gold-Token, 1 Unze)", category: "Edelmetalle" },

  { id: "CL=F", name: "Rohöl WTI", category: "Rohstoffe", perp: "CLUSDT" },
  { id: "BZ=F", name: "Rohöl Brent", category: "Rohstoffe", perp: "BZUSDT" },
  { id: "NG=F", name: "Erdgas", category: "Rohstoffe", perp: "NATGASUSDT" },
  { id: "HG=F", name: "Kupfer", category: "Rohstoffe", perp: "COPPERUSDT" },
  { id: "ZW=F", name: "Weizen", category: "Rohstoffe" },
  { id: "ZC=F", name: "Mais", category: "Rohstoffe" },
  { id: "ZS=F", name: "Sojabohnen", category: "Rohstoffe" },
  { id: "KC=F", name: "Kaffee", category: "Rohstoffe" },
  { id: "CC=F", name: "Kakao", category: "Rohstoffe" },
  { id: "SB=F", name: "Zucker", category: "Rohstoffe" },

  { id: "EURUSD=X", name: "Euro / US-Dollar", category: "Forex" },
  { id: "GBPUSD=X", name: "Britisches Pfund / US-Dollar", category: "Forex" },
  { id: "USDJPY=X", name: "US-Dollar / Japanischer Yen", category: "Forex" },
  { id: "USDCHF=X", name: "US-Dollar / Schweizer Franken", category: "Forex" },
  { id: "EURCHF=X", name: "Euro / Schweizer Franken", category: "Forex" },
  { id: "AUDUSD=X", name: "Australischer Dollar / US-Dollar", category: "Forex" },
  { id: "DX-Y.NYB", name: "US-Dollar-Index", category: "Forex" },
];

/** Futures contract from Binance exchangeInfo, reduced to what the picker needs. */
export interface FuturesSymbol {
  symbol: string;
  base: string;
  /** TradFi perpetual (metal, commodity, stock, ETF) rather than a crypto contract. */
  tradfi: boolean;
  /** Binance's own tags (underlyingSubType), used to sort unknown TradFi contracts into a category. */
  tags: string[];
}

interface RawFuturesSymbol {
  symbol?: string;
  baseAsset?: string;
  status?: string;
  contractType?: string;
  underlyingType?: string;
  underlyingSubType?: string[];
}

/** Trading perpetuals from /fapi/v1/exchangeInfo; TradFi contracts are marked by contract or underlying type. */
export function parseFuturesInfo(json: { symbols?: RawFuturesSymbol[] }): FuturesSymbol[] {
  return (json.symbols ?? [])
    .filter((s) => s.symbol && s.status === "TRADING" && (s.contractType ?? "").includes("PERPETUAL") && s.symbol.endsWith("USDT"))
    .map((s) => ({
      symbol: s.symbol!,
      base: s.baseAsset ?? s.symbol!.replace(/USDT$/, ""),
      tradfi: /TRAD/i.test(s.contractType ?? "") || (!!s.underlyingType && !["COIN", "INDEX"].includes(s.underlyingType)),
      tags: s.underlyingSubType ?? [],
    }));
}

/** Spot USDT pairs from /api/v3/ticker/price, without leveraged tokens. */
export function parseSpotTickers(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((t) => (t as { symbol?: string }).symbol ?? "")
    .filter((s) => s.endsWith("USDT") && !/(UP|DOWN|BULL|BEAR)USDT$/.test(s))
    .sort();
}

const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));
const BY_PERP = new Map(ASSETS.filter((a) => a.perp).map((a) => [a.perp!, a]));

/** Catalog entry for a loaded symbol (its id, its perpetual, or the coin on an exchange such as COINBASE:BTCUSD or BYBIT:BTCUSDT.P). */
export function findAsset(symbol: string): Asset | undefined {
  const known = BY_ID.get(symbol) ?? BY_PERP.get(symbol);
  const m = known ? null : /^[A-Z]+:(.+)$/.exec(symbol);
  if (!m) return known;
  // Spot, perpetual or future of a coin: the coin's entry when it is quoted in dollars (BTCUSD, BTCUSDT.P, BTC-USD-260327).
  const pair = parseVenueSymbol(symbol)?.pair;
  const coin = pair && ["USD", "USDT", "USDC"].includes(pair.quote) ? BY_ID.get(`${pair.base}USDT`) : undefined;
  return coin?.category === "Krypto" ? coin : BY_ID.get(m[1]);
}

export function categoryOfFutures(f: FuturesSymbol): AssetCategory {
  const known = BY_PERP.get(f.symbol);
  if (known) return known.category;
  if (!f.tradfi) return "Krypto";
  const tags = f.tags.join(" ").toLowerCase();
  if (/metal|gold|silver/.test(tags)) return "Edelmetalle";
  if (/commodit|energy|oil|gas|agri/.test(tags)) return "Rohstoffe";
  if (/etf|index/.test(tags)) return "Indizes & ETFs";
  return "Aktien";
}

export type DataSource = "binance" | "binance_futures" | "yahoo" | "twelvedata" | "venue" | "demo";

/**
 * Which symbol to load for an asset and where its prices come from.
 * With the Node server Yahoo delivers real exchange prices; the standalone
 * iPad build cannot reach Yahoo and uses Binance perpetuals where one exists.
 * `futures` is the set of listed perpetuals, or null while it is unknown.
 * With an exchange-feed key (`exchangeFeed`) stocks, indices and forex load real exchange prices from Twelve Data.
 */
export function resolveAsset(asset: Asset, standalone: boolean, futures: Set<string> | null, exchangeFeed = false): { symbol: string; source: DataSource } {
  if (asset.category === "Krypto" || asset.id.endsWith("USDT")) return { symbol: asset.id, source: "binance" };
  if (exchangeFeed && feedSymbol(asset.id)) return { symbol: asset.id, source: "twelvedata" };
  if (!standalone) return { symbol: asset.id, source: "yahoo" };
  if (asset.perp && (futures === null || futures.has(asset.perp))) return { symbol: asset.perp, source: "binance_futures" };
  return { symbol: asset.id, source: "demo" };
}

export interface SearchHit {
  symbol: string;
  name: string;
  category: AssetCategory;
  /** Set for catalog entries; extra Binance pairs have none. */
  asset?: Asset;
  /** A market from an exchange's list (BYBIT:BTCUSDT.P, ETHBTC): loaded as it is, not mapped to the picker's exchange or form. */
  fixed?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");

/** Catalog matches first, then further Binance spot pairs and perpetuals not in the catalog. */
export function searchAssets(query: string, spot: string[], futures: FuturesSymbol[]): SearchHit[] {
  const q = norm(query);
  const match = (...texts: string[]) => !q || texts.some((t) => norm(t).includes(q));
  const hits: SearchHit[] = ASSETS.filter((a) => match(a.id, a.name, a.perp ?? "")).map((a) => ({ symbol: a.id, name: a.name, category: a.category, asset: a }));
  const seen = new Set<string>(ASSETS.flatMap((a) => (a.perp ? [a.id, a.perp] : [a.id])));
  for (const f of futures) {
    if (!f.tradfi || seen.has(f.symbol) || !match(f.symbol, f.base)) continue;
    seen.add(f.symbol);
    hits.push({ symbol: f.symbol, name: `${f.base} (Binance-Perpetual)`, category: categoryOfFutures(f) });
  }
  for (const s of spot) {
    if (seen.has(s) || !match(s)) continue;
    seen.add(s);
    hits.push({ symbol: s, name: s.replace(/USDT$/, " / Tether"), category: "Krypto" });
  }
  return hits;
}
