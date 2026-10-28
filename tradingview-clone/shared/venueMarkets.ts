/**
 * Every listed crypto market of an exchange (spot pairs, perpetuals, futures with an expiry), as symbols
 * shared/venues.ts can load. The lists come from each exchange's public instrument endpoint:
 * - Binance: /api/v3/ticker/price (spot), /fapi/v1/exchangeInfo (USDⓈ-M), /dapi/v1/exchangeInfo (COIN-M)
 * - Coinbase: /products · Kraken: /0/public/AssetPairs, futures /derivatives/api/v3/instruments
 * - Bybit: /v5/market/instruments-info?category=spot|linear|inverse · OKX: /api/v5/public/instruments?instType=SPOT|SWAP|FUTURES
 * - Bitstamp: /api/v2/trading-pairs-info/ · Bitfinex: /v2/conf/pub:list:pair:exchange and pub:list:pair:futures
 * - Bitget: /api/v2/spot/public/symbols, /api/v2/mix/market/contracts · KuCoin: /api/v2/symbols, futures /api/v1/contracts/active
 * - Deribit: /api/v2/public/get_instruments?currency=any&kind=spot|future|option · BitMEX: /api/v1/instrument/active
 * - Options: Binance /eapi/v1/exchangeInfo, OKX /api/v5/public/instruments?instType=OPTION&instFamily=BTC-USD|ETH-USD, Deribit
 */
import { krakenCoin, parseVenueSymbol, splitPair, type MarketKind, type VenueId } from "./venues.js";

export interface Market {
  /** Symbol to load (BTCUSDT for Binance spot, otherwise VENUE:…). */
  symbol: string;
  base: string;
  quote: string;
  kind: MarketKind;
  /** Expiry of a dated future (YYYY-MM-DD). */
  expiry?: string;
  /** Coin-margined contract. */
  inverse?: boolean;
  /** Options: strike price and call or put. */
  strike?: number;
  right?: "C" | "P";
}

type Json = unknown;

/**
 * Keeps only markets whose symbol loads back to the same kind (and, with `native`, the same exchange
 * instrument): guards against odd exchange names.
 */
function market(symbol: string, kind: MarketKind, extra: Partial<Market> = {}, native?: string): Market | null {
  const plainSpot = !symbol.includes(":");
  const pair = plainSpot ? splitPair(symbol) : parseVenueSymbol(symbol)?.pair;
  const inst = plainSpot ? null : parseVenueSymbol(symbol);
  if (!pair || (inst && inst.kind !== kind) || (native && inst?.native !== native)) return null;
  return { symbol, base: pair.base, quote: pair.quote, kind, ...(inst?.inverse ? { inverse: true } : {}), ...extra };
}

const yymmdd = (s: string) => `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
const isoDay = (ms: number | string) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : undefined);
const compact = (list: (Market | null)[]) => list.filter((m): m is Market => m !== null);

// ---------------- Parsers (pure, tested with the documented response shapes) ----------------

export function parseBinanceSpot(json: Json): Market[] {
  if (!Array.isArray(json)) return [];
  return compact(json.map((t) => market(String((t as { symbol?: string }).symbol ?? ""), "spot")).filter((m) => m && !/(UP|DOWN|BULL|BEAR)$/.test(m.base)));
}

interface BinanceContract {
  symbol: string;
  pair?: string;
  contractType?: string;
  status?: string;
  contractStatus?: string;
  deliveryDate?: number;
}

/** USDⓈ-M and COIN-M exchangeInfo: perpetuals as BINANCE:BTCUSDT.P / BINANCE:BTCUSD.P, quarterlies under their own name. */
export function parseBinanceFutures(json: Json): Market[] {
  const symbols = ((json as { symbols?: BinanceContract[] })?.symbols ?? []).filter((s) => (s.status ?? s.contractStatus) === "TRADING");
  return compact(
    symbols.map((s) => {
      const type = s.contractType ?? "";
      if (type.includes("PERPETUAL")) return market(`BINANCE:${s.pair ?? s.symbol}.P`, "perp");
      const dated = /_(\d{6})$/.exec(s.symbol);
      return dated ? market(`BINANCE:${s.symbol}`, "future", { expiry: yymmdd(dated[1]) }) : null;
    }),
  );
}

export function parseCoinbase(json: Json): Market[] {
  if (!Array.isArray(json)) return [];
  return compact(
    (json as { base_currency?: string; quote_currency?: string; status?: string; trading_disabled?: boolean }[])
      .filter((p) => p.status === "online" && !p.trading_disabled)
      .map((p) => market(`COINBASE:${p.base_currency}${p.quote_currency}`, "spot")),
  );
}

export function parseKrakenSpot(json: Json): Market[] {
  const result = (json as { result?: Record<string, { wsname?: string; status?: string }> })?.result ?? {};
  return compact(
    Object.values(result)
      .filter((p) => p.wsname && (p.status ?? "online") === "online")
      .map((p) => {
        const [base, quote] = p.wsname!.split("/");
        return market(`KRAKEN:${krakenCoin(base)}${krakenCoin(quote)}`, "spot");
      }),
  );
}

export function parseKrakenFutures(json: Json): Market[] {
  const list = (json as { instruments?: { symbol?: string; tradeable?: boolean }[] })?.instruments ?? [];
  return compact(
    list
      .filter((i) => i.tradeable && i.symbol)
      .map((i) => {
        const s = i.symbol!.toUpperCase();
        // PF_XBTUSD is the usual perpetual and gets the TradingView spelling; the others keep Kraken's names.
        const pf = /^PF_([A-Z0-9]+)USD$/.exec(s);
        if (pf) return market(`KRAKEN:${krakenCoin(pf[1])}USD.P`, "perp");
        if (s.startsWith("PI_")) return market(`KRAKEN:${s}`, "perp");
        const dated = /^F[IF]_.+_(\d{6})$/.exec(s);
        return dated ? market(`KRAKEN:${s}`, "future", { expiry: yymmdd(dated[1]) }) : null;
      }),
  );
}

interface BybitInstrument {
  symbol: string;
  status?: string;
  contractType?: string;
  baseCoin?: string;
  quoteCoin?: string;
  deliveryTime?: string;
}

export function parseBybit(json: Json, category: "spot" | "linear" | "inverse"): Market[] {
  const list = ((json as { result?: { list?: BybitInstrument[] } })?.result?.list ?? []).filter((i) => i.status === "Trading");
  return compact(
    list.map((i) => {
      if (category === "spot") return market(`BYBIT:${i.symbol}`, "spot");
      const type = i.contractType ?? "";
      if (type.endsWith("Perpetual")) {
        // BTCPERP is the USDC perpetual; inverse perpetuals are BTCUSD.
        const quote = i.symbol.endsWith("PERP") ? "USDC" : category === "inverse" ? "USD" : i.quoteCoin;
        return market(`BYBIT:${i.baseCoin}${quote}.P`, "perp");
      }
      return market(`BYBIT:${i.symbol}`, "future", { expiry: isoDay(i.deliveryTime ?? 0) });
    }),
  );
}

interface OkxInstrument {
  instId: string;
  state?: string;
  expTime?: string;
}

export function parseOkx(json: Json, type: "SPOT" | "SWAP" | "FUTURES"): Market[] {
  const list = ((json as { data?: OkxInstrument[] })?.data ?? []).filter((i) => i.state === "live");
  return compact(
    list.map((i) => {
      const [base, quote] = i.instId.split("-");
      if (type === "SPOT") return market(`OKX:${base}${quote}`, "spot");
      if (type === "SWAP") return market(`OKX:${base}${quote}.P`, "perp");
      return market(`OKX:${i.instId}`, "future", { expiry: isoDay(i.expTime ?? 0) });
    }),
  );
}

export function parseBitstamp(json: Json): Market[] {
  if (!Array.isArray(json)) return [];
  return compact(
    (json as { name?: string; trading?: string }[])
      .filter((p) => p.trading === "Enabled" && p.name)
      .map((p) => market(`BITSTAMP:${p.name!.replace("/", "")}`, "spot")),
  );
}

/** Bitfinex pair lists: [[ "BTCUSD", "ETHUST", "DOGE:USD", … ]] and [[ "BTCF0:USTF0", … ]]. */
export function parseBitfinex(json: Json, futures: boolean): Market[] {
  const list = Array.isArray(json) && Array.isArray(json[0]) ? (json[0] as string[]) : [];
  const coin = (q: string) => (q === "UST" ? "USDT" : q);
  return compact(
    list.map((p) => {
      if (futures) {
        const f = /^([A-Z0-9]+)F0:USTF0$/.exec(p);
        return f ? market(`BITFINEX:${f[1]}USDT.P`, "perp") : null;
      }
      const [base, quote] = p.includes(":") ? p.split(":") : [p.slice(0, 3), p.slice(3)];
      return /TEST/.test(p) ? null : market(`BITFINEX:${base}${coin(quote)}`, "spot");
    }),
  );
}

/** Option fields from strike and call/put. */
const opt = (expiry: string | undefined, strike: unknown, right: string): Partial<Market> => ({ expiry, strike: Number(strike), right: /^c/i.test(right) ? "C" : "P" });

export function parseBinanceOptions(json: Json): Market[] {
  const list = (json as { optionSymbols?: { symbol: string; strikePrice?: string; side?: string; expiryDate?: number; status?: string }[] })?.optionSymbols ?? [];
  return compact(list.filter((o) => (o.status ?? "TRADING") === "TRADING").map((o) => market(`BINANCE:${o.symbol}`, "option", opt(isoDay(o.expiryDate ?? 0), o.strikePrice, o.side ?? ""))));
}

export function parseOkxOptions(json: Json): Market[] {
  const list = ((json as { data?: { instId: string; state?: string; stk?: string; optType?: string; expTime?: string }[] })?.data ?? []).filter((i) => i.state === "live");
  return compact(list.map((i) => market(`OKX:${i.instId}`, "option", opt(isoDay(i.expTime ?? 0), i.stk, i.optType ?? ""))));
}

export function parseBitgetSpot(json: Json): Market[] {
  const list = ((json as { data?: { baseCoin: string; quoteCoin: string; status?: string }[] })?.data ?? []).filter((i) => i.status === "online");
  return compact(list.map((i) => market(`BITGET:${i.baseCoin}${i.quoteCoin}`, "spot")));
}

export function parseBitgetContracts(json: Json, product: "USDT-FUTURES" | "USDC-FUTURES" | "COIN-FUTURES"): Market[] {
  const list = ((json as { data?: { symbol: string; baseCoin: string; symbolType?: string; symbolStatus?: string; deliveryTime?: string }[] })?.data ?? []).filter(
    (i) => (i.symbolStatus ?? "normal") === "normal",
  );
  const quote = product === "USDT-FUTURES" ? "USDT" : product === "USDC-FUTURES" ? "USDC" : "USD";
  return compact(
    list.map((i) =>
      i.symbolType === "delivery"
        ? market(`BITGET:${i.symbol}`, "future", { expiry: isoDay(i.deliveryTime ?? 0) })
        : market(`BITGET:${i.baseCoin}${quote}.P`, "perp", {}, i.symbol),
    ),
  );
}

export function parseKucoinSpot(json: Json): Market[] {
  const list = ((json as { data?: { baseCurrency: string; quoteCurrency: string; enableTrading?: boolean }[] })?.data ?? []).filter((i) => i.enableTrading);
  return compact(list.map((i) => market(`KUCOIN:${i.baseCurrency}${i.quoteCurrency}`, "spot")));
}

export function parseKucoinFutures(json: Json): Market[] {
  const list = ((json as { data?: { symbol: string; baseCurrency: string; quoteCurrency: string; expireDate?: number | null; status?: string }[] })?.data ?? []).filter((i) => i.status === "Open");
  return compact(
    list.map((i) =>
      i.expireDate
        ? market(`KUCOIN:${i.symbol}`, "future", { expiry: isoDay(i.expireDate) })
        : market(`KUCOIN:${krakenCoin(i.baseCurrency)}${i.quoteCurrency}.P`, "perp", {}, i.symbol),
    ),
  );
}

interface DeribitInstrument {
  instrument_name: string;
  kind?: string;
  is_active?: boolean;
  settlement_period?: string;
  expiration_timestamp?: number;
  strike?: number;
  option_type?: string;
}

export function parseDeribit(json: Json): Market[] {
  const list = ((json as { result?: DeribitInstrument[] })?.result ?? []).filter((i) => i.is_active !== false);
  return compact(
    list.map((i) => {
      const name = i.instrument_name;
      const perp = /^([A-Z0-9]+)(?:_(USDC|USDT))?-PERPETUAL$/.exec(name);
      if (perp) return market(`DERIBIT:${perp[1]}${perp[2] ?? "USD"}.P`, "perp", {}, name);
      if (i.kind === "spot") {
        const [base, quote] = name.split("_");
        return market(`DERIBIT:${base}${quote}`, "spot", {}, name) ?? market(`DERIBIT:${name}`, "spot");
      }
      const expiry = isoDay(i.expiration_timestamp ?? 0);
      if (i.kind === "option") return market(`DERIBIT:${name}`, "option", opt(expiry, i.strike, i.option_type ?? ""));
      return market(`DERIBIT:${name}`, "future", { expiry });
    }),
  );
}

export function parseBitmex(json: Json): Market[] {
  if (!Array.isArray(json)) return [];
  const list = (json as { symbol: string; typ?: string; underlying?: string; quoteCurrency?: string; state?: string; expiry?: string | null }[]).filter((i) => i.state === "Open");
  return compact(
    list.map((i) => {
      if (i.typ === "FFWCSX") return market(`BITMEX:${krakenCoin(i.underlying ?? "")}${i.quoteCurrency}.P`, "perp", {}, i.symbol);
      if (i.typ === "FFCCSX") return market(`BITMEX:${i.symbol}`, "future", { expiry: i.expiry ? i.expiry.slice(0, 10) : undefined });
      if (i.typ === "IFXXXP") return market(`BITMEX:${i.symbol}`, "spot");
      return null;
    }),
  );
}

// ---------------- Loading ----------------

type Source = [url: string, parse: (json: Json) => Market[]];

const SOURCES: Record<VenueId, Source[]> = {
  BINANCE: [
    ["https://api.binance.com/api/v3/ticker/price", parseBinanceSpot],
    ["https://fapi.binance.com/fapi/v1/exchangeInfo", parseBinanceFutures],
    ["https://dapi.binance.com/dapi/v1/exchangeInfo", parseBinanceFutures],
    ["https://eapi.binance.com/eapi/v1/exchangeInfo", parseBinanceOptions],
  ],
  COINBASE: [["https://api.exchange.coinbase.com/products", parseCoinbase]],
  KRAKEN: [
    ["https://api.kraken.com/0/public/AssetPairs", parseKrakenSpot],
    ["https://futures.kraken.com/derivatives/api/v3/instruments", parseKrakenFutures],
  ],
  BYBIT: [
    ["https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000", (j) => parseBybit(j, "spot")],
    ["https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000", (j) => parseBybit(j, "linear")],
    ["https://api.bybit.com/v5/market/instruments-info?category=inverse&limit=1000", (j) => parseBybit(j, "inverse")],
  ],
  OKX: [
    ["https://www.okx.com/api/v5/public/instruments?instType=SPOT", (j) => parseOkx(j, "SPOT")],
    ["https://www.okx.com/api/v5/public/instruments?instType=SWAP", (j) => parseOkx(j, "SWAP")],
    ["https://www.okx.com/api/v5/public/instruments?instType=FUTURES", (j) => parseOkx(j, "FUTURES")],
    ["https://www.okx.com/api/v5/public/instruments?instType=OPTION&instFamily=BTC-USD", parseOkxOptions],
    ["https://www.okx.com/api/v5/public/instruments?instType=OPTION&instFamily=ETH-USD", parseOkxOptions],
  ],
  BITSTAMP: [["https://www.bitstamp.net/api/v2/trading-pairs-info/", parseBitstamp]],
  BITFINEX: [
    ["https://api-pub.bitfinex.com/v2/conf/pub:list:pair:exchange", (j) => parseBitfinex(j, false)],
    ["https://api-pub.bitfinex.com/v2/conf/pub:list:pair:futures", (j) => parseBitfinex(j, true)],
  ],
  BITGET: [
    ["https://api.bitget.com/api/v2/spot/public/symbols", parseBitgetSpot],
    ["https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES", (j) => parseBitgetContracts(j, "USDT-FUTURES")],
    ["https://api.bitget.com/api/v2/mix/market/contracts?productType=USDC-FUTURES", (j) => parseBitgetContracts(j, "USDC-FUTURES")],
    ["https://api.bitget.com/api/v2/mix/market/contracts?productType=COIN-FUTURES", (j) => parseBitgetContracts(j, "COIN-FUTURES")],
  ],
  KUCOIN: [
    ["https://api.kucoin.com/api/v2/symbols", parseKucoinSpot],
    ["https://api-futures.kucoin.com/api/v1/contracts/active", parseKucoinFutures],
  ],
  DERIBIT: [
    ["https://www.deribit.com/api/v2/public/get_instruments?currency=any&kind=spot", parseDeribit],
    ["https://www.deribit.com/api/v2/public/get_instruments?currency=any&kind=future", parseDeribit],
    ["https://www.deribit.com/api/v2/public/get_instruments?currency=any&kind=option", parseDeribit],
  ],
  BITMEX: [["https://www.bitmex.com/api/v1/instrument/active", parseBitmex]],
};

export interface VenueMarkets {
  markets: Market[];
  /** Lists that could not be loaded (blocked or down), by URL. */
  failed: string[];
}

/** All markets of an exchange; lists that fail are reported, the others still count. */
export async function loadVenueMarkets(venue: VenueId, fetchJson: (url: string) => Promise<Json>): Promise<VenueMarkets> {
  const results = await Promise.allSettled(SOURCES[venue].map(async ([url, parse]) => parse(await fetchJson(url))));
  const seen = new Set<string>();
  const markets: Market[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") failed.push(SOURCES[venue][i][0]);
    else for (const m of r.value) if (!seen.has(m.symbol)) seen.add(m.symbol), markets.push(m);
  });
  return { markets, failed };
}

const KIND_ORDER: Record<MarketKind, number> = { spot: 0, perp: 1, future: 2, option: 3 };
const QUOTE_ORDER = ["USDT", "USD", "USDC", "FDUSD", "EUR"];

/**
 * Markets matching a search ("btc", "BTCUSDT", "eth perp", "BYBIT:BTCUSDT.P", "btc call 100000"): the pair or symbol must
 * start with the text, "perp"/"future"/"spot"/"option"/"call"/"put" in the query narrows the kind, a number the strike.
 * Options (thousands per exchange) only show when asked for or when the text has digits (an expiry or strike).
 * Sorted by kind, then quote (`quoteOrder`: the EU mode puts EUR and USDC first), then expiry and strike.
 */
export function searchMarkets(markets: Market[], query: string, quoteOrder: string[] = QUOTE_ORDER): Market[] {
  const quoteRank = (q: string) => (quoteOrder.includes(q) ? quoteOrder.indexOf(q) : quoteOrder.length);
  const words = query.toUpperCase().split(/\s+/).filter(Boolean);
  const kinds = new Set<MarketKind>();
  const rest: string[] = [];
  let right: "C" | "P" | null = null;
  let strike: number | null = null;
  for (const w of words) {
    if (/^(OPTION|OPTIONS|OPTIONEN|OPT)$/.test(w)) kinds.add("option");
    else if (/^(CALL|CALLS)$/.test(w)) (kinds.add("option"), (right = "C"));
    else if (/^(PUT|PUTS)$/.test(w)) (kinds.add("option"), (right = "P"));
    else if (/^\d+([.,]\d+)?$/.test(w) && rest.length > 0) strike = Number(w.replace(",", "."));
    else if (/^(PERP|PERPS|PERPETUAL|\.P|SWAP)$/.test(w)) kinds.add("perp");
    else if (/^(FUTURE|FUTURES|FUT|LAUFZEIT)$/.test(w)) kinds.add("future");
    else if (w === "SPOT") kinds.add("spot");
    else rest.push(w.replace(/[^A-Z0-9]/g, ""));
  }
  const text = rest.join("");
  const withOptions = kinds.has("option") || /\d/.test(text);
  return markets
    .filter((m) => (m.kind !== "option" || withOptions) && (!right || m.right === right) && (strike === null || m.strike === strike))
    .filter((m) => (kinds.size === 0 || kinds.has(m.kind)) && (!text || (m.base + m.quote).startsWith(text) || m.symbol.replace(/[^A-Z0-9]/g, "").startsWith(text) || m.symbol.replace(/^[A-Z]+:|[^A-Z0-9]/g, "").startsWith(text)))
    .sort((a, b) => {
      const exact = Number(b.base === text) - Number(a.base === text);
      return exact || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || quoteRank(a.quote) - quoteRank(b.quote) || (a.expiry ?? "").localeCompare(b.expiry ?? "") || (a.strike ?? 0) - (b.strike ?? 0) || a.symbol.localeCompare(b.symbol);
    });
}

/** "BTC / USDT · Perpetual", "BTC / USD · Futures 27.03.2026 (Coin-margined)", "BTC / USD · Call 100.000 27.03.2026". */
export function marketLabel(m: Market): string {
  const day = m.expiry ? ` ${m.expiry.split("-").reverse().join(".")}` : "";
  const kind =
    m.kind === "spot"
      ? "Spot"
      : m.kind === "perp"
        ? "Perpetual"
        : m.kind === "option"
          ? `${m.right === "C" ? "Call" : "Put"} ${m.strike?.toLocaleString("de-DE") ?? ""}${day}`
          : `Futures${day}`;
  return `${m.base} / ${m.quote} · ${kind}${m.inverse ? " (Coin-margined)" : ""}`;
}
